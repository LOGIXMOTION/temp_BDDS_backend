const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PLANS_DIR = process.platform === 'win32' ? './plans' : '/usr/src/app/plans';

// let db = new sqlite3.Database('./rtls_demo.db');

//Use the following line for docker and comment the above line
let db = new sqlite3.Database('/usr/src/app/db/rtls_demo.db');
let MAIN_BLE_BEACONS = [];
let DB_HUB_TO_ZONE = {};
let DB_HUB_WEIGHTS = {};

const app = express();
const PORT = process.env.PORT || 3000;
const cors = require('cors');

const HUB_DATA_ENDPOINT = '/data';
const ZONE_DATA_ENDPOINT = '/zones';
const HUB_ENDPOINT = '/hubs';
const ASSET_DATA_ENDPOINT = '/assets';
const RSSI_DATA_ENDPOINT = '/rssi-data';
const TIME_TRACKING_ENDPOINT = '/time-tracking-data';
const NEW_ASSETS_ENDPOINT = '/new-assets';
const DELETE_ASSETS_ENDPOINT = '/delete-assets';
const PLANS_ENDPOINT = '/plans';

const beacon_history_CLEANUP_INTERVAL = 5 * 60 * 1000;; // Interval set for x milliseconds

const RSSI_HOLD_TIME = 15000; //  milliseconds to hold RSSI values in cache
const DEGRADED_RSSI = -85;  // Moving average default when a beacon missing from a hub. 
                            // But this also means that for assigning a beacon to a hub, 
                            //the hub should have at least one reading for the beacon that is > -85
// So this means the threshold for coming back from "Outside Range" is -85

// When a beacon is outside range for 10 minutes, it is set to "Outside Range"
const OUTSIDE_RANGE_TIME = 10 * 60 * 1000; // in milliseconds  


// // This is insecure !!
// app.use(PLANS_ENDPOINT, express.static(PLANS_DIR));

// Configure multer for image upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Parse the JSON data from form-data
        const planData = JSON.parse(req.body.data || '{}');
        const org = planData.org;
        
        if (!org) {
            return cb(new Error('Organization name is required'));
        }

        const orgDir = path.join(PLANS_DIR, org);
        
        // Create directories if they don't exist
        fs.mkdirSync(PLANS_DIR, { recursive: true });
        fs.mkdirSync(orgDir, { recursive: true });
        
        cb(null, orgDir);
    },
    filename: (req, file, cb) => {
        cb(null, 'temp.png');
    }
});

const upload = multer({ 
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Only PNG files are allowed'));
        }
    }
});

setInterval(cleanupBeaconHistory, beacon_history_CLEANUP_INTERVAL);

// Call the function periodically to ensure MAIN_BLE_BEACONS stays updated
setInterval(updateMainBleBeacons, 5000); // Update every x ms
updateMainBleBeacons();

// Run the outside range check every x seconds
setInterval(updateBeaconsAndCheckRange, 1000);

// Run the updateTimeTracking function every x seconds
setInterval(updateTimeTracking, 5000);

// Run the function to update hub mappings every x seconds
updateHubZoneMapping();
setInterval(updateHubZoneMapping, 30000);

// Function to update MAIN_BLE_BEACONS from the database
async function updateMainBleBeacons() {
    try {
        const query = "SELECT macAddress, assetName, humanFlag FROM assets";
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error fetching assets:", err);
                return;
            }
            MAIN_BLE_BEACONS = rows || []; // Update the global MAIN_BLE_BEACONS variable
            // console.log("MAIN_BLE_BEACONS updated with", MAIN_BLE_BEACONS.length, "entries.");
        });
    } catch (error) {
        console.error("Error updating MAIN_BLE_BEACONS:", error);
    }
}

function updateHubZoneMapping() {
    db.all("SELECT id, zoneName, weight, type, coordinates FROM hubs", [], (err, rows) => {
        if (err) {
            console.error("Error fetching hub data:", err);
            return;
        }
        DB_HUB_TO_ZONE = {};
        DB_HUB_WEIGHTS = {};
        
        rows.forEach(row => {
            DB_HUB_TO_ZONE[row.id] = row.zoneName;
            DB_HUB_WEIGHTS[row.id] = row.weight || 1.0;
        });
        
        console.log("Updated hub mappings. Total hubs:", rows.length);
    });
}


function updateBeaconsAndCheckRange() {
    const currentTime = Date.now();
    const outsideRangeThreshold = currentTime - OUTSIDE_RANGE_TIME;

    db.all("SELECT b.macAddress, b.bestZone, MAX(bh.timestamp) as latestTimestamp FROM beacons b JOIN beacon_history bh ON b.macAddress = bh.macAddress GROUP BY b.macAddress", [], (err, rows) => {
        if (err) {
            console.error('Error getting beacons with history:', err);
            return;
        }

        db.all("SELECT macAddress FROM beacons WHERE macAddress NOT IN (SELECT macAddress FROM beacon_history)", [], (err, missingRows) => {
            if (err) {
                console.error('Error checking beacons without history:', err);
                return;
            }

            missingRows.forEach(row => {
                db.run("UPDATE beacons SET bestZone = 'Outside Range' WHERE macAddress = ?", 
                    [row.macAddress], 
                    (updateErr) => {
                        if (updateErr) {
                            console.error('Error updating to Outside Range:', updateErr);
                        }
                    });
            });
        });

        rows.forEach(row => {
            if (row.latestTimestamp < outsideRangeThreshold) {
                db.run("UPDATE beacons SET bestZone = 'Outside Range' WHERE macAddress = ?", 
                    [row.macAddress], 
                    (rangeUpdateErr) => {
                        if (rangeUpdateErr) {
                            console.error('Error updating beacon to Outside Range:', rangeUpdateErr);
                        }
                    });
            }
        });
    });
}

// functions for time tracking
function convertToGermanDate(utcTimestamp) {
    // Create a Date object from the UTC timestamp
    const date = new Date(utcTimestamp);
    
    // Convert to German time
    const germanTime = new Date(date.toLocaleString("en-US", {timeZone: "Europe/Berlin"}));
    
    // Format the date
    const day = String(germanTime.getDate()).padStart(2, '0');
    const month = String(germanTime.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const year = germanTime.getFullYear();
    // Print function convertToGermanDate has been called with the following parameters
    // console.log('convertToGermanDate has been called with the following parameters:', utcTimestamp, day, month, year);
    return `${day}.${month}.${year}`;
}

function formatTimeCounter(milliseconds) {
    // Calculate total seconds
    const totalSeconds = Math.floor(milliseconds / 1000);
    
    // Calculate hours, minutes, and seconds
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    // Pad each component with zeros if necessary and join with colons
    return [hours, minutes, seconds]
        .map(v => v.toString().padStart(2, '0'))
        .join(':');
}

// Core for getting the difference between two dates : the following 2 functions.

// Function to parse a German date string (DD.MM.YYYY) into a Date object
function parseGermanDate(dateStr) {
    const [day, month, year] = dateStr.split('.').map(Number);
    // Create a Date object
    return new Date(year, month - 1, day); // Months are 0-indexed in JavaScript Date objects
}

// Function to calculate the difference in days between two dates
function getDateDifference(dateStr1, dateStr2) {
    const date1 = parseGermanDate(dateStr1);
    const date2 = parseGermanDate(dateStr2);
    
    // Get the difference in milliseconds
    const diffInMillis = Math.abs(date2 - date1);

    // Convert the difference from milliseconds to days
    const diffInDays = Math.ceil(diffInMillis / (1000 * 60 * 60 * 24));
    
    return diffInDays;
}



function updateTimeTracking() {
    const currentTime = Date.now();
    const currentGermanDate = convertToGermanDate(currentTime);

    console.log("updateTimeTracking triggered at :", new Date(currentTime).toLocaleString());
    console.log("Current German Date:", currentGermanDate);

    const humanBeacons = MAIN_BLE_BEACONS.filter(beacon => beacon.humanFlag).map(beacon => beacon.macAddress);

    if (humanBeacons.length === 0) {
        console.log("No human beacons found in the MAIN_BLE_BEACONS list.");
        return;
    }

    // console.log("Human Beacons:", humanBeacons);

    db.all(`SELECT macAddress, assetName, lastUpdatedTimestamp 
            FROM beacons 
            WHERE bestZone = 'Outside Range' 
            AND macAddress IN (${humanBeacons.map(mac => `'${mac}'`).join(",")})`, [], (err, outsideRangeBeacons) => {
        if (err) {
            console.error("Error fetching beacons outside range:", err);
            return;
        }

        // console.log("Beacons outside range:", outsideRangeBeacons);

        db.get("SELECT COUNT(*) AS count FROM time_tracking", [], (err, row) => {
            if (err) {
                console.error("Error checking time_tracking table:", err);
                return;
            }

            const isTimeTrackingEmpty = row.count === 0;
            console.log("Is time_tracking table empty?", isTimeTrackingEmpty);

            if (!isTimeTrackingEmpty) {
                outsideRangeBeacons.forEach(beacon => {
                    const lastUpdatedGermanDate = convertToGermanDate(beacon.lastUpdatedTimestamp);

                    db.get("SELECT * FROM time_tracking WHERE macAddress = ? AND stopTimeSection IS NULL ORDER BY date DESC, startTimeSection DESC LIMIT 1", [beacon.macAddress], (err, timeTrackingRow) => {
                        if (err) {
                            console.error("Error fetching from time_tracking:", err);
                            return;
                        }

                        if (timeTrackingRow) {
                            console.log("Found ongoing session for beacon:", beacon.macAddress);

                            if (lastUpdatedGermanDate === currentGermanDate) {
                                console.log("Updating stopTimeSection for beacon due to server downtime:", beacon.macAddress);
                                const timeCounter = formatTimeCounter(currentTime - timeTrackingRow.startTimeSection);
                                db.run("UPDATE time_tracking SET stopTimeSection = ?, timeCounter = ?, assetName = ? WHERE id = ?", 
                                    [currentTime, timeCounter, beacon.assetName, timeTrackingRow.id], (err) => {
                                    if (err) {
                                        console.error("Error updating stopTimeSection:", err);
                                    }
                                });
                            } 
                            // For closing an active beacon when the day changes and the beacon goes Outside Range
                            else if (lastUpdatedGermanDate != currentGermanDate && timeTrackingRow.date == currentGermanDate && !timeTrackingRow.stopTimeSection)
                            {
                                console.log("Closing beacon that was active through midnight (Closing on the new date with current time)", beacon.macAddress);
                                const timeCounter = formatTimeCounter(currentTime - timeTrackingRow.startTimeSection);
                                db.run("UPDATE time_tracking SET stopTimeSection = ?, timeCounter = ?, assetName = ? WHERE id = ?", 
                                    [currentTime, timeCounter, beacon.assetName, timeTrackingRow.id], (err) => {
                                    if (err) {
                                        console.error("Error updating stopTimeSection for midnight:", err);
                                    }
                                });
                                
                            } else {
                                console.log("lastUpdatedGermanDate !== currentGermanDate for beacon:", beacon.macAddress);
                                console.log("User stopped working yesterday for beacon:", beacon.macAddress);
                                const timeCounter = formatTimeCounter(beacon.lastUpdatedTimestamp - timeTrackingRow.startTimeSection);
                                db.run("UPDATE time_tracking SET stopTimeSection = ?, timeCounter = ?, date = ? WHERE id = ?", 
                                    [beacon.lastUpdatedTimestamp, timeCounter, lastUpdatedGermanDate, timeTrackingRow.id], (err) => {
                                    if (err) {
                                        console.error("Error updating stopTimeSection for yesterday:", err);
                                    }
                                });
                            }
                        }
                    });
                });
            }

            db.all(`SELECT macAddress, assetName, lastUpdatedTimestamp 
                    FROM beacons 
                    WHERE bestZone != 'Outside Range' 
                    AND macAddress IN (${humanBeacons.map(mac => `'${mac}'`).join(",")})`, [], (err, activeBeacons) => {
                if (err) {
                    console.error("Error fetching active beacons:", err);
                    return;
                }

                // console.log("Active beacons:", activeBeacons);

                activeBeacons.forEach(beacon => {
                    const lastUpdatedGermanDate = convertToGermanDate(beacon.lastUpdatedTimestamp);

                    db.get("SELECT * FROM time_tracking WHERE macAddress = ? AND stopTimeSection IS NULL ORDER BY date DESC, startTimeSection DESC LIMIT 1", [beacon.macAddress], (err, timeTrackingRow) => {
                        if (err) {
                            console.error("Error fetching from time_tracking:", err);
                            return;
                        }

                        if (timeTrackingRow) {
                            // console.log("Found ongoing session for active beacon:", beacon.macAddress);

                            if ((lastUpdatedGermanDate === currentGermanDate) && (timeTrackingRow.date === currentGermanDate)) {
                                console.log("lastUpdatedGermanDate =", lastUpdatedGermanDate, "currentGermanDate =", currentGermanDate);
                                console.log("Updating ongoing entry for beacon:", beacon.macAddress);
                                const timeCounter = formatTimeCounter(currentTime - timeTrackingRow.startTimeSection);
                                db.run("UPDATE time_tracking SET timeCounter = ?, assetName = ? WHERE id = ?", 
                                    [timeCounter, beacon.assetName, timeTrackingRow.id], (err) => {
                                    if (err) {
                                        console.error("Error updating timeCounter:", err);
                                    }
                                });
                            }
                            // For closing an existing active beacon when the day changes
                            else if (timeTrackingRow.date != currentGermanDate) {
                                // Close the old entry
                                console.log("Closing out entry for previous day for beacon:", beacon.macAddress);
                
                                // Step 1: Get the current date in local time zone
                                const currentDate = new Date();

                                // Step 2: Subtract one day to get the previous day
                                const previousDay = new Date(currentDate);
                                previousDay.setDate(currentDate.getDate() - 1);

                                // Step 3: Set the time to 23:59:59.999 in local time
                                previousDay.setHours(23, 59, 59, 999);

                                // Step 4: Create a new Date object using UTC methods
                                const utcYear = previousDay.getUTCFullYear();
                                const utcMonth = previousDay.getUTCMonth(); // Note: getUTCMonth() returns 0-indexed month
                                const utcDate = previousDay.getUTCDate();
                                const utcHours = previousDay.getUTCHours();
                                const utcMinutes = previousDay.getUTCMinutes();
                                const utcSeconds = previousDay.getUTCSeconds();
                                const utcMilliseconds = previousDay.getUTCMilliseconds();

                                // Combine these to create a new Date object in UTC
                                const endOfDayGermanTime =  Date.UTC(utcYear, utcMonth, utcDate, utcHours, utcMinutes, utcSeconds, utcMilliseconds);
                                console.log("End of prev. day in German time:", endOfDayGermanTime);

                                // Calculate the time difference between the startTimeSection and the end of the day
                                const timeCounter = formatTimeCounter(endOfDayGermanTime - timeTrackingRow.startTimeSection);
                
                                // Update the stopTimeSection with the end of the day and the timeCounter
                                db.run("UPDATE time_tracking SET stopTimeSection = ?, timeCounter = ?, assetName = ? WHERE id = ?",
                                    [endOfDayGermanTime, timeCounter, beacon.assetName, timeTrackingRow.id], (err) => {
                                    if (err) {
                                        console.error("Error updating time tracking for previous day:", err);
                                    } else {
                                        console.log("Closed entry with stopTimeSection at end of the day for beacon:", beacon.macAddress);
                                    }
                                });
                            } 
                            // Creating a new entry for the current day for yesterdays active beacon
                            else if ((timeTrackingRow.date == currentGermanDate) && timeTrackingRow.stopTimeSection) {
                                // Create a new entry for today
                                console.log("Creating new entry for current day for beacon:", beacon.macAddress);
                                db.run("INSERT INTO time_tracking (date, macAddress, assetName, startTimeSection, timeCounter) VALUES (?, ?, ?, ?, '00:00:00')", 
                                    [currentGermanDate, beacon.macAddress, beacon.assetName, currentTime], (err) => {
                                    if (err) {
                                        console.error("Error inserting new time_tracking entry:", err);
                                    }
                                });
                            } 
                            else {
                                // Update the current entry with ongoing timeCounter
                                console.log("Updating ongoing entry with current timeCounter for beacon:", beacon.macAddress);
                                const timeCounter = formatTimeCounter(currentTime - timeTrackingRow.startTimeSection);
                                db.run("UPDATE time_tracking SET timeCounter = ?, assetName = ? WHERE id = ?", 
                                    [timeCounter, beacon.assetName, timeTrackingRow.id], (err) => {
                                    if (err) {
                                        console.error("Error updating ongoing timeCounter:", err);
                                    }
                                });
                            }
                        } 
                        else {
                            console.log("Creating new time_tracking entry for active beacon:", beacon.macAddress);
                            db.run("INSERT INTO time_tracking (date, macAddress, assetName, startTimeSection, timeCounter) VALUES (?, ?, ?, ?, '00:00:00')", 
                                [currentGermanDate, beacon.macAddress, beacon.assetName, currentTime], (err) => {
                                if (err) {
                                    console.error("Error inserting new time_tracking entry:", err);
                                }
                            });
                        }
                    });
                });
            });
        });
    });
}

// end of functions for time tracking

// Enable CORS for all routes
app.use(cors());

app.use(express.json());



// FUNCTIONS AND CONSTANTS FOR RSSI DATA PROCESSING


// Create a cache to store the last known RSSI values
const rssiCache = new Map();

function updateRssiCache(macAddress, hubId, rssi, timestamp) {
	const key = `${macAddress}-${hubId}`;
	rssiCache.set(key, { rssi, timestamp });
}

function getLatestRssi(macAddress, hubId, currentTime) {
	const key = `${macAddress}-${hubId}`;
	const cachedValue = rssiCache.get(key);
	
	if (!cachedValue) return DEGRADED_RSSI;
	
	const timeSinceLastReading = currentTime - cachedValue.timestamp;
	
	if (timeSinceLastReading <= RSSI_HOLD_TIME) {
		return cachedValue.rssi;
	} else {
		return DEGRADED_RSSI;
	}
}

const calculateZoneAverageForBeacon = (zoneName, macAddress, callback) => {
    const currentTime = Date.now();
    const sixtySecondsAgo = currentTime - 61000;
    
    // First get all hubs in this zone
    db.all("SELECT id, weight FROM hubs WHERE zoneName = ?", [zoneName], (err, hubs) => {
        if (err) return callback(err);
        if (!hubs.length) return callback(null, DEGRADED_RSSI);

        let zoneSum = 0;
        let hubsProcessed = 0;
        
        // Calculate average for each hub
        hubs.forEach(hub => {
            calculateAverageForHubAndBeacon(hub.id, macAddress, (err, hubAverage) => {
                if (!err) {
                    zoneSum += hubAverage * (hub.weight || 1.0);
                }
                hubsProcessed++;
                
                if (hubsProcessed === hubs.length) {
                    const finalAverage = zoneSum / hubs.length;
                    callback(null, finalAverage);
                }
            });
        });
    });
};

// Keep the original hub average calculation
const calculateAverageForHubAndBeacon = (hubId, macAddress, callback) => {
    const currentTime = Date.now();
    const sixtySecondsAgo = currentTime - 61000;
    
    db.all("SELECT rssi, timestamp FROM beacon_history WHERE macAddress = ? AND hubId = ? AND timestamp > ?", 
        [macAddress, hubId, sixtySecondsAgo], (err, rows) => {
        if (err) {
            return callback(err);
        }

        const totalPossibleReadings = 20;
        let sum = 0;
        let lastTimestamp = 0;
        const hubWeight = DB_HUB_WEIGHTS[hubId] || 1.0;

        rows.forEach(row => {
            sum += row.rssi * hubWeight;
            updateRssiCache(macAddress, hubId, row.rssi, row.timestamp);
            lastTimestamp = Math.max(lastTimestamp, row.timestamp);
        });

        const missingReadings = totalPossibleReadings - rows.length;
        for (let i = 0; i < missingReadings; i++) {
            const assumedTimestamp = lastTimestamp + (i + 1) * 3000;
            sum += getLatestRssi(macAddress, hubId, assumedTimestamp) * hubWeight;
        }

        const average = sum / totalPossibleReadings;
        callback(null, average);
    });
};

// Endpoint to receive data from hubs
app.post(HUB_DATA_ENDPOINT, (req, res) => {

    try {
        // console.log(req.body);
        console.log('data received from hub =>', req.body.id);
        // console.log('Request body:', JSON.stringify(req.body, null, 2));

        const hubData = req.body;
        const hubId = hubData.id;

        if (DB_HUB_TO_ZONE[hubId] && Array.isArray(hubData.items)) {
            hubData.items.forEach(item => {
                if (!item || typeof item !== 'object') return; // Skip invalid items

                const beaconConfig = MAIN_BLE_BEACONS.find(beacon => beacon.macAddress === item.macAddress);
                if (beaconConfig) {
                    let currentRssi;
                    
                    // Handle different possible data structures
                    if (Array.isArray(item.rssi) && item.rssi.length > 0 && item.rssi[0] && typeof item.rssi[0].rssi === 'number') {
                        currentRssi = item.rssi[0].rssi;
                    } else if (typeof item.rssi === 'number') {
                        currentRssi = item.rssi;
                    } else if (typeof item.rssi === 'object' && item.rssi && typeof item.rssi.rssi === 'number') {
                        currentRssi = item.rssi.rssi;
                    } else {
                        // If RSSI data is invalid, skip this item
                        return;
                    }
                    const currentTime = Date.now();

                    // Update RSSI cache
                    updateRssiCache(item.macAddress, hubId, currentRssi, currentTime);

                    // Insert into beacon_history
                    db.run("INSERT INTO beacon_history (macAddress, rssi, hubId, timestamp) VALUES (?, ?, ?, ?)", [item.macAddress, currentRssi, hubId, currentTime], (err) => {
                        if (err) {
                            console.error("Error inserting into beacon_history:", err.message);
                            return;
                        }

                        // Update the best zone for the beacon
                        calculateZoneAverageForBeacon(DB_HUB_TO_ZONE[hubId], item.macAddress, 
                            (err, currentZoneAverage) => {
                                if (err) {
                                    console.error("Error calculating zone average:", err.message);
                                    return;
                                }
                                
                                db.get("SELECT bestZone FROM beacons WHERE macAddress = ?", 
                                    [item.macAddress], 
                                    (err, row) => {
                                        const currentBestZone = row ? row.bestZone : null;
                                        
                                        if (currentBestZone && currentBestZone !== 'Outside Range') {
                                            calculateZoneAverageForBeacon(currentBestZone, item.macAddress, 
                                                (err, bestZoneAverage) => {
                                                    if (currentZoneAverage > bestZoneAverage) {
                                                        db.run("UPDATE beacons SET bestZone = ? WHERE macAddress = ?",
                                                            [DB_HUB_TO_ZONE[hubId], item.macAddress]);
                                                    }
                                                });
                                        } else {
                                            db.run("REPLACE INTO beacons (macAddress, bestZone, lastUpdatedTimestamp, assetName) VALUES (?, ?, ?, ?)",
                                                [item.macAddress, DB_HUB_TO_ZONE[hubId], currentTime, beaconConfig.assetName]);
                                        }
                                    });
                            });
                    });
                }
            });

        }

        res.send({ status: 'OK' });
    } catch (error) {
        console.error('Error processing data:', error);
        res.status(500).json({ status: 'error', message: 'An error occurred while processing the data' });
    }

});

// End point to insert new assets 
app.post(NEW_ASSETS_ENDPOINT, (req, res) => {
    const assets = req.body;

    if (!Array.isArray(assets)) {
        return res.status(400).send({ error: 'Invalid data format. Expected an array of assets.' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;"); // Start a transaction

        const promises = assets.map(asset => {
            return new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO beacons (macAddress, bestZone, lastUpdatedTimestamp, assetName)
                    VALUES (?, 'Outside Range', ?, ?)
                    ON CONFLICT(macAddress)
                    DO UPDATE SET bestZone = 'Outside Range', lastUpdatedTimestamp = ?, assetName = ?`,
                    [asset.macAddress, Date.now(), asset.assetName, Date.now(), asset.assetName],
                    (err) => {
                        if (err) {
                            return reject(err);
                        }

                        // Insert into beacons table
                        db.run(
                            `INSERT INTO beacons (macAddress, bestHubId, lastUpdatedTimestamp, assetName)
                            VALUES (?, 'Outside Range', ?, ?)
                            ON CONFLICT(macAddress)
                            DO UPDATE SET bestHubId = 'Outside Range', lastUpdatedTimestamp = ?, assetName = ?`,
                            [asset.macAddress, Date.now(), asset.assetName, Date.now(), asset.assetName],
                            (err) => {
                                if (err) {
                                    return reject(err);
                                }
                                resolve({ macAddress: asset.macAddress, status: 'processed' });
                            }
                        );
                    }
                );
            });
        });

        Promise.all(promises)
            .then(results => {
                db.run("COMMIT;"); // Commit the transaction
                res.status(200).send({ message: 'Assets processed successfully.', results });
            })
            .catch(error => {
                db.run("ROLLBACK;"); // Rollback the transaction
                console.error('Error processing assets:', error);
                res.status(500).send({ error: 'Internal server error.' });
            });
    });
});

app.delete(DELETE_ASSETS_ENDPOINT, (req, res) => {
    const { macAddresses } = req.body;

    if (!Array.isArray(macAddresses)) {
        return res.status(400).send({ error: 'Invalid data format. Expected an array of MAC addresses.' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;", (err) => {
            if (err) {
                console.error('Error starting transaction:', err);
                return res.status(500).send({ error: 'Failed to start transaction.' });
            }

            const promises = macAddresses.map(macAddress => {
                return new Promise((resolve, reject) => {
                    // Delete from all relevant tables
                    db.run("DELETE FROM beacons WHERE macAddress = ?", [macAddress], (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            db.run("DELETE FROM beacon_history WHERE macAddress = ?", [macAddress], (err) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    db.run("DELETE FROM time_tracking WHERE macAddress = ?", [macAddress], (err) => {
                                        if (err) {
                                            reject(err);
                                        } else {
                                            db.run("DELETE FROM assets WHERE macAddress = ?", [macAddress], (err) => {
                                                if (err) {
                                                    reject(err);
                                                } else {
                                                    console.log(`Deleted all entries for MAC address: ${macAddress}`);
                                                    resolve(macAddress);
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        }
                    });
                });
            });

            Promise.all(promises)
                .then(results => {
                    db.run("COMMIT;", (err) => {
                        if (err) {
                            console.error('Error committing transaction:', err);
                            res.status(500).send({ error: 'Failed to commit transaction.' });
                        } else {
                            res.status(200).send({ message: 'Assets deleted successfully.', deleted: results });
                        }
                    });
                })
                .catch(error => {
                    console.error('Error deleting assets:', error);
                    db.run("ROLLBACK;", (rollbackErr) => {
                        if (rollbackErr) {
                            console.error('Error rolling back transaction:', rollbackErr);
                        }
                        res.status(500).send({ error: 'Failed to delete assets.' });
                    });
                });
        });
    });
});



// Modified ZONE_DATA_ENDPOINT to include all hub/zone information
app.get(ZONE_DATA_ENDPOINT, (req, res) => {
    const query = `
        SELECT 
            z.*,
            COUNT(b.macAddress) as beacon_count
        FROM zones z
        LEFT JOIN beacons b ON z.zoneName = b.bestZone
        GROUP BY z.zoneName
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching zone data:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        const formattedZones = rows.map(row => ({
            name: row.zoneName,
            count: row.beacon_count || 0,
            zoneData: {
                vertices: JSON.parse(row.vertices || '[]'),
                color: row.color,
                opacity: row.opacity
            }
        }));

        // Add "Outside Range" zone
        db.get(
            "SELECT COUNT(macAddress) as count FROM beacons WHERE bestZone = 'Outside Range'",
            [],
            (err, outsideRange) => {
                if (err) {
                    console.error('Error fetching outside range count:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                formattedZones.push({
                    name: "Outside Range",
                    count: outsideRange.count || 0
                });

                res.json({ zones: formattedZones });
            }
        );
    });
});

// New endpoint to create/update hub and zone
app.post(ZONE_DATA_ENDPOINT, (req, res) => {
    const { zoneName, vertices, color, opacity } = req.body;
    
    const query = `
        INSERT INTO zones (zoneName, vertices, color, opacity, updated_at) 
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(zoneName) DO UPDATE SET
            vertices = excluded.vertices,
            color = excluded.color,
            opacity = excluded.opacity,
            updated_at = excluded.updated_at`;

    db.run(query, 
        [zoneName, JSON.stringify(vertices), color, opacity, Math.floor(Date.now() / 1000)],
        (err) => {
            if (err) {
                res.status(500).json({ error: 'Failed to create/update zone' });
                return;
            }
            res.json({ message: 'Zone created/updated successfully' });
        });
});

// New endpoint to delete zone
app.delete(`${ZONE_DATA_ENDPOINT}/:zoneName`, (req, res) => {
    const { zoneName } = req.params;
    
    // Check if zone has hubs
    db.get('SELECT COUNT(*) as count FROM hubs WHERE zoneName = ?', 
        [zoneName], (err, row) => {
            if (row.count > 0) {
                res.status(400).json({ error: 'Zone has assigned hubs' });
                return;
            }
            
            db.run('DELETE FROM zones WHERE zoneName = ?', [zoneName],
                (err) => {
                    if (err) {
                        res.status(500).json({ error: 'Failed to delete zone' });
                        return;
                    }
                    res.json({ message: 'Zone deleted' });
                });
        });
});

// New endpoint to get all hub data
app.get(HUB_ENDPOINT, (req, res) => {
    const query = `
        SELECT h.id, h.zoneName, h.weight, h.type, h.coordinates, 
               h.height, h.orientation_angle, h.tilt_angle,
               h.created_at, h.updated_at,
               COUNT(b.macAddress) as beacon_count
        FROM hubs h
        LEFT JOIN beacons b ON h.zoneName = b.bestZone
        GROUP BY h.id
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching hub data:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        const formattedResponse = rows.map(row => ({
            hubId: row.id,
            zoneName: row.zoneName,
            weight: row.weight,
            type: row.type,
            coordinates: row.coordinates ? JSON.parse(row.coordinates) : null,
            height: row.height || 0,
            orientationAngle: row.orientation_angle || 0,
            tiltAngle: row.tilt_angle || 0,
            beaconCount: row.beacon_count || 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        res.json({ hubs: formattedResponse });
    });
});

// Modified hub endpoint
app.post(HUB_ENDPOINT, (req, res) => {
    const { hubId, zoneName, weight, type, coordinates, height, orientationAngle, tiltAngle } = req.body;
    
    if (!hubId || !zoneName || !type || !coordinates) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    db.get('SELECT zoneName FROM zones WHERE zoneName = ?', 
        [zoneName], (err, row) => {
            if (!row) {
                res.status(400).json({ error: 'Zone does not exist' });
                return;
            }
            
            const query = `
                INSERT INTO hubs (
                    id, zoneName, weight, type, coordinates, 
                    height, orientation_angle, tilt_angle, 
                    updated_at
                ) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    zoneName = excluded.zoneName,
                    weight = excluded.weight,
                    type = excluded.type,
                    coordinates = excluded.coordinates,
                    height = excluded.height,
                    orientation_angle = excluded.orientation_angle,
                    tilt_angle = excluded.tilt_angle,
                    updated_at = excluded.updated_at`;

            db.run(query,
                [
                    hubId, 
                    zoneName, 
                    weight || 1.0, 
                    type,
                    JSON.stringify(coordinates),
                    height || 0,
                    orientationAngle || 0,
                    tiltAngle || 0,
                    Math.floor(Date.now() / 1000)
                ],
                (err) => {
                    if (err) {
                        console.error('Error creating/updating hub:', err);
                        res.status(500).json({ error: 'Failed to create/update hub' });
                        return;
                    }
                    res.json({ message: 'Hub created/updated successfully' });
                });
        });
});

// Need new Hub delete endpoint
app.delete(`${HUB_ENDPOINT}/:hubId`, (req, res) => {
    const { hubId } = req.params;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Get zone information before deletion
        db.get('SELECT zoneName FROM hubs WHERE id = ?', [hubId], (err, hubRow) => {
            if (err || !hubRow) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Hub not found' });
            }

            const zoneName = hubRow.zoneName;

            // Delete the hub
            db.run('DELETE FROM hubs WHERE id = ?', [hubId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Failed to delete hub' });
                }

                // Check if this was the last hub in the zone
                db.get('SELECT COUNT(*) as count FROM hubs WHERE zoneName = ?', 
                    [zoneName], (err, countRow) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Failed to check zone status' });
                        }

                        if (countRow.count === 0) {
                            // Move all beacons in this zone to Outside Range
                            db.run("UPDATE beacons SET bestZone = 'Outside Range' WHERE bestZone = ?", 
                                [zoneName], (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: 'Failed to update beacons' });
                                    }

                                    db.run('COMMIT');
                                    res.json({ 
                                        message: 'Hub deleted and beacons updated', 
                                        wasLastHub: true,
                                        zoneAffected: zoneName
                                    });
                                });
                        } else {
                            db.run('COMMIT');
                            res.json({ 
                                message: 'Hub deleted',
                                wasLastHub: false,
                                zoneAffected: zoneName
                            });
                        }
                    });
            });
        });
    });
});


// New endpoint to get all asset data including humanFlag

app.get(ASSET_DATA_ENDPOINT, (req, res) => {
    const query = `
        SELECT 
            b.macAddress, 
            b.bestZone, 
            b.assetName,
            COALESCE(b.bestZone, 'Outside Range') as zone,
            a.humanFlag
        FROM 
            beacons b 
            LEFT JOIN assets a ON b.macAddress = a.macAddress
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(err);
            res.status(500).json({ error: 'Internal server error' });
            return;
        }

        const assetsByZone = {};

        rows.forEach(row => {
            const zone = row.zone || 'Unknown';
            if (!assetsByZone[zone]) {
                assetsByZone[zone] = [];
            }

            assetsByZone[zone].push({
                macAddress: row.macAddress,
                assetName: row.assetName || null,
                humanFlag: row.humanFlag  // This will be 1 or 0 based on the assets table
            });
        });

        res.json(assetsByZone);
    });
});



// Endpoint to get RSSI data for all beacons across all hubs
app.get(RSSI_DATA_ENDPOINT, (req, res) => {
    const query = "SELECT macAddress, assetName, currentZone, rssi, MAX(lastSeen) as lastSeen, assignedZone FROM v_beacon_latest_rssi GROUP BY macAddress, currentZone";
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(err);
            res.status(500).json({ error: 'Internal server error' });
            return;
        }
        const formattedResponse = {};
        rows.forEach(row => {
            if (!formattedResponse[row.macAddress]) {
                formattedResponse[row.macAddress] = {
                    assetName: row.assetName
                };
            }
            formattedResponse[row.macAddress][row.currentZone] = {
                rssi: row.rssi,
                lastSeen: new Date(row.lastSeen).toISOString(), // Convert to ISO timestamp
                assignedZone: row.assignedZone || 'Outside Range'
            };
        });
        res.json(formattedResponse);
    });
});

// Endpoint to get time tracking data
app.get(TIME_TRACKING_ENDPOINT, (req, res) => {
    // Get the current date in German format
    const currentDateGerman = convertToGermanDate(Date.now());

    const query = `
        SELECT t.macAddress, b.assetName, t.date, t.startTimeSection, t.stopTimeSection, t.timeCounter
        FROM time_tracking t
        LEFT JOIN beacons b ON t.macAddress = b.macAddress
        ORDER BY t.macAddress, t.date ASC, t.startTimeSection ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching time tracking data:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        const filteredRows = rows.filter(row => {
            const dateDifference = getDateDifference(row.date, currentDateGerman);
            return dateDifference <= 5;
        });

        const formattedResponse = filteredRows.reduce((acc, row) => {
            const macAddress = row.macAddress;
            const assetName = row.assetName || 'Unknown';

            if (!acc[macAddress]) {
                acc[macAddress] = {
                    assetName,
                    timeSections: []
                };
            }

            const startTime = new Date(parseInt(row.startTimeSection));
            const stopTime = row.stopTimeSection ? new Date(parseInt(row.stopTimeSection)) : null;
            let duration;

            if (row.timeCounter) {
                duration = row.timeCounter; // Directly use the timeCounter from the DB
            } else if (row.stopTimeSection) {
                const durationMilliseconds = parseInt(row.stopTimeSection) - parseInt(row.startTimeSection);
                duration = formatTimeCounter(durationMilliseconds);
            } else {
                duration = '00:00:00';
            }

            acc[macAddress].timeSections.push({
                date: row.date,
                startTime: startTime.toISOString(),
                stopTime: stopTime ? stopTime.toISOString() : null,
                duration
            });

            return acc;
        }, {});

        res.json(formattedResponse);
    });
});

// Floor Plan Endpoints
app.post(PLANS_ENDPOINT, upload.single('image'), (req, res) => {

    try{
        const planData = JSON.parse(req.body.data);
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            const query = `
                INSERT INTO plans (
                    org, locale_info, floor, open_ground, image_path,
                    top_left, top_right, bottom_left, rotation,
                    center, opacity, scale, dimensions
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(query, [
                planData.org,
                planData.locale_info,
                planData.floor,
                planData.openGround,
                'temp',
                JSON.stringify(planData.topLeft),
                JSON.stringify(planData.topRight),
                JSON.stringify(planData.bottomLeft),
                planData.rotation,
                JSON.stringify(planData.center),
                planData.opacity,
                planData.scale,
                JSON.stringify(planData.dimensions)
            ], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Failed to save plan data' });
                }

                const id = this.lastID;
                const newPath = path.join(PLANS_DIR, planData.org, `${id}.png`);
                
                fs.rename(file.path, newPath, (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Failed to save image' });
                    }

                    db.run('UPDATE plans SET image_path = ? WHERE id = ?', 
                        [`${id}.png`, id], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Failed to update image path' });
                        }

                        db.run('COMMIT');
                        res.json({ id });
                    });
                });
            });
        });
    } catch (error) {
        console.error('Error saving floor plan:', error);
        res.status(400).json({ error: 'Invalid plan data' })
    }

});

// GET endpoint
app.get(PLANS_ENDPOINT, (req, res) => {
    const { org, locale_info, floor, openGround } = req.query;
    
    let query = 'SELECT * FROM plans WHERE org = ? AND locale_info = ?';
    const params = [org, locale_info];

    if (floor !== undefined) {
        query += ' AND floor = ?';
        params.push(floor);
    }
    if (openGround !== undefined) {
        query += ' AND open_ground = ?';
        params.push(openGround);
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch plans' });
        }

        const plans = rows.map(row => ({
            id: row.id,
            org: row.org,
            locale_info: row.locale_info,
            floor: row.floor,
            openGround: row.open_ground,
            imagePath: `/plans/image/${row.org}/${row.image_path.replace('.png', '')}`,
            topLeft: JSON.parse(row.top_left),
            topRight: JSON.parse(row.top_right),
            bottomLeft: JSON.parse(row.bottom_left),
            rotation: row.rotation,
            center: JSON.parse(row.center),
            opacity: row.opacity,
            scale: row.scale,
            dimensions: JSON.parse(row.dimensions)
        }));

        res.json({ plans });
    });
});


// Secure image serving

// // Example future addition
// const authMiddleware = (req, res, next) => {
//     // Add your authentication logic here
//     // For example, check JWT token
//     const token = req.headers.authorization;
//     if (!token) {
//         return res.status(401).json({ error: 'Unauthorized' });
//     }
    
//     // Verify token matches org
//     const { org } = req.params;
//     if (!verifyOrgAccess(token, org)) {
//         return res.status(403).json({ error: 'Forbidden' });
//     }
    
//     next();
// };
// FOR FUTURE USE
// app.get(`${PLANS_ENDPOINT}/image/:org/:id`, authMiddleware, (req, res) => {
app.get(`${PLANS_ENDPOINT}/image/:org/:id`, (req, res) => {
    const { org, id } = req.params;
    
    // First verify the image exists in database
    db.get('SELECT * FROM plans WHERE org = ? AND image_path = ?', 
        [org, `${id}.png`], (err, row) => {
            if (err || !row) {
                return res.status(404).json({ error: 'Image not found' });
            }

            const imagePath = path.join(PLANS_DIR, org, `${id}.png`);
            
            // Check if file exists
            if (!fs.existsSync(imagePath)) {
                return res.status(404).json({ error: 'Image file not found' });
            }

            // Set content type
            res.setHeader('Content-Type', 'image/png');
            
            // Stream the file
            fs.createReadStream(imagePath).pipe(res);
    });
});

// DELETE endpoint
app.delete(`${PLANS_ENDPOINT}/:id`, (req, res) => {
    const { id } = req.params;

    db.get('SELECT org, image_path FROM plans WHERE id = ?', [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        const imagePath = path.join(PLANS_DIR, row.org, row.image_path);
        
        db.run('DELETE FROM plans WHERE id = ?', [id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete plan' });
            }

            fs.unlink(imagePath, (err) => {
                if (err) {
                    console.error('Failed to delete image file:', err);
                }
                res.json({ message: 'Plan deleted successfully' });
            });
        });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    cleanupBeaconHistory(); // Initial cleanup
});

process.on('exit', () => {
  db.close();
});


// CLEANUP DATABASE
function cleanupBeaconHistory() {
    const keepRecords = 5000;
    db.run(`DELETE FROM beacon_history WHERE id NOT IN (
        SELECT id FROM beacon_history ORDER BY timestamp DESC LIMIT ?
    )`, [keepRecords], (err) => {
        if (err) {
            console.error('Error cleaning up beacon history:', err.message);
        } else {
            console.log('Cleaned up beacon history, keeping', keepRecords, 'records');
        }
    });
}
