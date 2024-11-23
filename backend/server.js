const express = require('express');
const sqlite3 = require('sqlite3').verbose();
let db = new sqlite3.Database('./rtls_demo.db');

//Use the following line for docker and comment the above line
// let db = new sqlite3.Database('/usr/src/app/db/rtls_demo.db');
const { ZONES_CONFIG, MAIN_BLE_BEACONS, HUB_TO_ZONE, HUB_WEIGHTS,  } = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;
const cors = require('cors');

const HUB_DATA_ENDPOINT = '/data';
const ZONE_DATA_ENDPOINT = '/zones';
const ASSET_DATA_ENDPOINT = '/assets';
const RSSI_DATA_ENDPOINT = '/rssi-data';
const TIME_TRACKING_ENDPOINT = '/time-tracking-data';

const beacon_history_CLEANUP_INTERVAL = 3600000; // Interval set for 1 hour in milliseconds

const RSSI_HOLD_TIME = 15000; //  milliseconds to hold RSSI values in cache
const DEGRADED_RSSI = -85;  // Moving average default when a beacon missing from a hub. 
                            // But this also means that for assigning a beacon to a hub, 
                            //the hub should have at least one reading for the beacon that is > -85
// So this means the threshold for coming back from "Outside Range" is -85

// When a beacon is outside range for 10 minutes, it is set to "Outside Range"
const OUTSIDE_RANGE_TIME = 10 * 60 * 1000; // in milliseconds  

// Run the outside range check every minute
setInterval(updateBeaconsAndCheckRange, 1000);

// Run the updateTimeTracking function every x seconds
setInterval(updateTimeTracking, 5000);

   


function updateBeaconsAndCheckRange() {
    const currentTime = Date.now();
    const outsideRangeThreshold = currentTime - OUTSIDE_RANGE_TIME;

    // First, update lastUpdatedTimestamp for each beacon
    db.all("SELECT b.macAddress, b.bestHubId, MAX(bh.timestamp) as latestTimestamp FROM beacons b JOIN beacon_history bh ON b.macAddress = bh.macAddress AND b.bestHubId = bh.hubId GROUP BY b.macAddress", [], (err, rows) => {
        if (err) {
            console.error('Error updating beacon timestamps:', err);
            return;
        }

        rows.forEach(row => {
            db.run("UPDATE beacons SET lastUpdatedTimestamp = ? WHERE macAddress = ?", [row.latestTimestamp, row.macAddress], (updateErr) => {
                if (updateErr) {
                    console.error('Error updating lastUpdatedTimestamp:', updateErr);
                }
            });

            // Check if the beacon is outside range
            if (row.latestTimestamp < outsideRangeThreshold) {
                db.run("UPDATE beacons SET bestHubId = 'Outside Range' WHERE macAddress = ?", [row.macAddress], (rangeUpdateErr) => {
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
            WHERE bestHubId = 'Outside Range' 
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
                    WHERE bestHubId != 'Outside Range' 
                    AND macAddress IN (${humanBeacons.map(mac => `'${mac}'`).join(",")})`, [], (err, activeBeacons) => {
                if (err) {
                    console.error("Error fetching active beacons:", err);
                    return;
                }

                console.log("Active beacons:", activeBeacons);

                activeBeacons.forEach(beacon => {
                    const lastUpdatedGermanDate = convertToGermanDate(beacon.lastUpdatedTimestamp);

                    db.get("SELECT * FROM time_tracking WHERE macAddress = ? AND stopTimeSection IS NULL ORDER BY date DESC, startTimeSection DESC LIMIT 1", [beacon.macAddress], (err, timeTrackingRow) => {
                        if (err) {
                            console.error("Error fetching from time_tracking:", err);
                            return;
                        }

                        if (timeTrackingRow) {
                            console.log("Found ongoing session for active beacon:", beacon.macAddress);

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
// Uncoment the follow for production and comment the above line
// app.use('/asset-tracking-api', express.json());


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

const calculateAverageForHubAndBeacon = (hubId, macAddress, callback) => {
	const currentTime = Date.now();
	const sixtySecondsAgo = currentTime - 61000;
	
	db.all("SELECT rssi, timestamp FROM beacon_history WHERE macAddress = ? AND hubId = ? AND timestamp > ?", [macAddress, hubId, sixtySecondsAgo], (err, rows) => {
		if (err) {
			return callback(err);
		}

		const totalPossibleReadings = 20;
		let sum = 0;
		let lastTimestamp = 0;

		rows.forEach(row => {
			sum += row.rssi * HUB_WEIGHTS[hubId];
			updateRssiCache(macAddress, hubId, row.rssi, row.timestamp);
			lastTimestamp = Math.max(lastTimestamp, row.timestamp);
		});

		const missingReadings = totalPossibleReadings - rows.length;
		for (let i = 0; i < missingReadings; i++) {
			const assumedTimestamp = lastTimestamp + (i + 1) * 3000; // Assume readings every 3 seconds
			sum += getLatestRssi(macAddress, hubId, assumedTimestamp) * HUB_WEIGHTS[hubId];
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

        if (HUB_TO_ZONE[hubId] && Array.isArray(hubData.items)) {
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

                        // Calculate moving average for current hub and compare with best hub
                        calculateAverageForHubAndBeacon(hubId, item.macAddress, (err, currentHubAverage) => {
                            if (err) {
                                console.error("Error calculating average:", err.message);
                                return;
                            }
                            db.get("SELECT bestHubId FROM beacons WHERE macAddress = ?", [item.macAddress], (err, row) => {
                                let bestHubId = row ? row.bestHubId : null;

                                if (bestHubId) {
                                    calculateAverageForHubAndBeacon(bestHubId, item.macAddress, (err, bestHubAverage) => {
                                        if (currentHubAverage > bestHubAverage) {
                                            db.run("UPDATE beacons SET bestHubId = ? WHERE macAddress = ?", [hubId, item.macAddress]);
                                        }
                                    });
                                } else {
                                    db.run("REPLACE INTO beacons (macAddress, bestHubId, lastUpdatedTimestamp, assetName) VALUES (?, ?, ?, ?)", [item.macAddress, hubId, currentTime, beaconConfig.assetName]);
                                }
                            });
                        });
                    });
                }
            });

            db.run("REPLACE INTO hubs (id, zone) VALUES (?, ?)", [hubId, HUB_TO_ZONE[hubId]]);
        }

        res.send({ status: 'OK' });
    } catch (error) {
        console.error('Error processing data:', error);
        res.status(500).json({ status: 'error', message: 'An error occurred while processing the data' });
    }

});


// Endpoint to serve zone data
app.get(ZONE_DATA_ENDPOINT, (req, res) => {
    const zones = ZONES_CONFIG.map(zone => zone.name);

    // Helper function to get the beacon count and hub ID for a zone
    const getZoneData = (zone) => {
        return new Promise((resolve, reject) => {
            // Fetch the count based on bestHubId for each zone
            db.get("SELECT COUNT(b.macAddress) as count, h.id as hubId FROM beacons b JOIN hubs h ON b.bestHubId = h.id WHERE h.zone = ?", [zone], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    // Find the corresponding zone config
                    const zoneConfig = ZONES_CONFIG.find(config => config.name === zone);
                    resolve({
                        name: zone,
                        count: row ? row.count : 0,
                        hubId: row ? row.hubId : (zoneConfig ? zoneConfig.hubId : null)
                    });
                }
            });
        });
    };

    // Use Promise.all to wait for all database calls to complete
    Promise.all(zones.map(zone => getZoneData(zone)))
        .then(results => {
            res.json({ zones: results });
        })
        .catch(error => {
            console.error('Error fetching zone data:', error);
            res.status(500).send({ error: 'Internal server error' });
        });
});


// New endpoint to get all asset data
app.get(ASSET_DATA_ENDPOINT, (req, res) => {
    db.all("SELECT b.macAddress, b.bestHubId, b.assetName, CASE WHEN b.bestHubId = 'Outside Range' THEN 'Outside Range' ELSE h.zone END as zone FROM beacons b LEFT JOIN hubs h ON b.bestHubId = h.id", [], (err, rows) => {
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
                assetName: row.assetName || null
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
                assignedZone: row.assignedZone || 'Unknown'
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


app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);


  // Run cleanup every hour
  setInterval(cleanupBeaconHistory, beacon_history_CLEANUP_INTERVAL);

  // Also run it once at startup
  cleanupBeaconHistory();
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