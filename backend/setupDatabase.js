const sqlite3 = require('sqlite3').verbose();

// Create a new database file
let db = new sqlite3.Database('./rtls_demo.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the SQLite database.');
});

// Create tables for hubs, beacons, and beacon history
db.serialize(() => {
    // Table for hubs
    db.run("CREATE TABLE IF NOT EXISTS hubs (id TEXT PRIMARY KEY, zone TEXT)");

    // Table for beacons to store the current best hub for each beacon
    db.run("CREATE TABLE IF NOT EXISTS beacons (macAddress TEXT PRIMARY KEY, bestHubId TEXT, lastUpdatedTimestamp INTEGER, assetName TEXT)");

    // Table for beacon history to store RSSI readings over time
    db.run("CREATE TABLE IF NOT EXISTS beacon_history (id INTEGER PRIMARY KEY AUTOINCREMENT, macAddress TEXT, rssi INTEGER, hubId TEXT, timestamp INTEGER)");
    
    // Add an index to speed up the search for specific beacon and hub combinations
    db.run("CREATE INDEX IF NOT EXISTS idx_mac_hub ON beacon_history(macAddress, hubId)");

    db.run("CREATE INDEX IF NOT EXISTS idx_timestamp ON beacon_history(timestamp)");



    // Table for time tracking
    db.run(`CREATE TABLE IF NOT EXISTS time_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        macAddress TEXT,
        assetName TEXT,
        startTimeSection INTEGER,
        stopTimeSection INTEGER,
        timeCounter TEXT,
        UNIQUE(date, macAddress, startTimeSection)
    )`);
    
    // Add an index for efficient querying
    db.run("CREATE INDEX IF NOT EXISTS idx_time_tracking_date_mac ON time_tracking(date, macAddress)");

    // Add an index for ordering by date DESC, macAddress, and startTimeSection
    db.run("CREATE INDEX IF NOT EXISTS idx_time_tracking_order ON time_tracking(date DESC, macAddress, startTimeSection)");



    
    // View for the latest RSSI readings for each beacon
    // Update the view to include the assetName
    db.run(`CREATE VIEW IF NOT EXISTS v_beacon_latest_rssi AS
        SELECT
            bh.macAddress,
            b.assetName,
            bh.hubId,
            h.zone AS currentZone,
            b.bestHubId,
            hb.zone AS assignedZone,
            bh.rssi,
            MAX(bh.timestamp) as lastSeen
        FROM
            beacon_history bh
        JOIN
            hubs h ON bh.hubId = h.id
        JOIN
            beacons b ON b.macAddress = bh.macAddress
        LEFT JOIN
            hubs hb ON hb.id = b.bestHubId
        GROUP BY
            bh.macAddress, bh.hubId;`);

    db.run(`
        CREATE TABLE IF NOT EXISTS assets (
            macAddress TEXT PRIMARY KEY,
            assetName TEXT,
            humanFlag BOOLEAN
        )
    `);
    
});



db.close();