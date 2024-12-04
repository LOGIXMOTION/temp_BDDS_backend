const sqlite3 = require('sqlite3').verbose();
let db = new sqlite3.Database('./rtls_demo.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to SQLite database.');
});

db.serialize(() => {
    // Drop view since it depends on tables
    db.run("DROP VIEW IF EXISTS v_beacon_latest_rssi");

    // Create zones table
    db.run(`CREATE TABLE IF NOT EXISTS zones (
        zoneName TEXT PRIMARY KEY,
        vertices TEXT,
        color TEXT,
        opacity REAL,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
    )`);

    // Create base tables first
    db.run(`CREATE TABLE IF NOT EXISTS hubs (
        id TEXT PRIMARY KEY,
        zoneName TEXT REFERENCES zones(zoneName),
        weight REAL DEFAULT 1.0,
        type TEXT,
        coordinates TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
    )`);

    // Create beacons table
    db.run(`CREATE TABLE IF NOT EXISTS beacons (
        macAddress TEXT PRIMARY KEY,
        bestZone TEXT,
        lastUpdatedTimestamp INTEGER,
        assetName TEXT
    )`);

    // Create beacon_history table
    db.run(`CREATE TABLE IF NOT EXISTS beacon_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        macAddress TEXT,
        rssi INTEGER,
        hubId TEXT,
        timestamp INTEGER
    )`);

    // Create assets table
    db.run(`CREATE TABLE IF NOT EXISTS assets (
        macAddress TEXT PRIMARY KEY,
        assetName TEXT,
        humanFlag BOOLEAN
    )`);

    // Create time_tracking table
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

    // Create indexes
    db.run("CREATE INDEX IF NOT EXISTS idx_mac_hub ON beacon_history(macAddress, hubId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_timestamp ON beacon_history(timestamp)");
    db.run("CREATE INDEX IF NOT EXISTS idx_time_tracking_date_mac ON time_tracking(date, macAddress)");
    db.run("CREATE INDEX IF NOT EXISTS idx_time_tracking_order ON time_tracking(date DESC, macAddress, startTimeSection)");
    db.run("CREATE INDEX IF NOT EXISTS idx_hubs_zone ON hubs(zoneName)");
    db.run("CREATE INDEX IF NOT EXISTS idx_beacons_zone ON beacons(bestZone)");
    db.run("CREATE INDEX IF NOT EXISTS idx_zones_updated ON zones(updated_at)");

    // Create view and then add new columns
    db.run(`CREATE VIEW IF NOT EXISTS v_beacon_latest_rssi AS
        SELECT
            bh.macAddress,
            b.assetName,
            bh.hubId,
            COALESCE(h.zoneName, 'Outside Range') AS currentZone,
            b.bestZone,
            COALESCE(b.bestZone, 'Outside Range') AS assignedZone,
            bh.rssi,
            MAX(bh.timestamp) as lastSeen
        FROM
            beacon_history bh
        JOIN
            hubs h ON bh.hubId = h.id
        JOIN
            beacons b ON b.macAddress = bh.macAddress
        GROUP BY
            bh.macAddress, bh.hubId`,
        err => {
            if (err) console.error('Error creating view:', err);
            
            // Add new columns to hubs table if they don't exist
            db.get("PRAGMA table_info(hubs)", [], (err, rows) => {
                if (err) {
                    console.error("Error checking hubs table:", err);
                    closeDb();
                    return;
                }

                let alterTableCommands = [];
                
                // Build list of commands to run
                alterTableCommands.push(
                    "ALTER TABLE hubs ADD COLUMN type TEXT",
                    "ALTER TABLE hubs ADD COLUMN coordinates TEXT"
                );

                alterTableCommands.push(
                    "ALTER TABLE hubs ADD COLUMN type TEXT",
                    "ALTER TABLE hubs ADD COLUMN coordinates TEXT",
                    "ALTER TABLE hubs ADD COLUMN height REAL DEFAULT 0",
                    "ALTER TABLE hubs ADD COLUMN orientation_angle REAL DEFAULT 0",
                    "ALTER TABLE hubs ADD COLUMN tilt_angle REAL DEFAULT 0"
                );
                

                // Execute commands sequentially
                function runNextCommand() {
                    if (alterTableCommands.length === 0) {
                        console.log("Database setup completed successfully.");
                        closeDb();
                        return;
                    }

                    const cmd = alterTableCommands.shift();
                    db.run(cmd, (err) => {
                        if (err && !err.message.includes('duplicate column')) {
                            console.error(`Error executing ${cmd}:`, err);
                        }
                        runNextCommand();
                    });
                }

                runNextCommand();
            });
        }
    );
});

function closeDb() {
    db.close((err) => {
        if (err) console.error(err.message);
        console.log('Closed database connection.');
    });
}