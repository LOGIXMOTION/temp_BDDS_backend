// setupDatabase.js
const sqlite3 = require('sqlite3').verbose();

// Create a new database file
let db = new sqlite3.Database('./rtls_demo.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the SQLite database.');
});

db.serialize(() => {
    // Drop the view first since it depends on other tables
    db.run("DROP VIEW IF EXISTS v_beacon_latest_rssi");

    // Create zones table
    db.run(`
        CREATE TABLE IF NOT EXISTS zones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            vertices TEXT,
            color TEXT,
            opacity REAL,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
    `);

    // Modify hubs table to reference zones
    db.run(`
        CREATE TABLE IF NOT EXISTS hubs_new (
            id TEXT PRIMARY KEY,
            zone_id INTEGER,
            latitude REAL,
            longitude REAL,
            height REAL,
            weight REAL,
            orientation_angle REAL,
            tilt_angle REAL,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY (zone_id) REFERENCES zones(id)
        )
    `);

    // Migrate existing data
    db.run(`
        INSERT INTO zones (name)
        SELECT DISTINCT zone FROM hubs WHERE zone != 'Outside Range'
    `);

    db.run(`
        INSERT INTO hubs_new (id, zone_id)
        SELECT h.id, z.id 
        FROM hubs h
        JOIN zones z ON h.zone = z.name
    `);

    // Drop old table and rename new one
    db.run("DROP TABLE IF EXISTS hubs");
    db.run("ALTER TABLE hubs_new RENAME TO hubs");

    // Create beacon_zones table to track best zone for each beacon
    db.run(`
        CREATE TABLE IF NOT EXISTS beacon_zones (
            macAddress TEXT PRIMARY KEY,
            zone_id INTEGER,
            last_updated INTEGER,
            FOREIGN KEY (zone_id) REFERENCES zones(id)
        )
    `);

    // Migrate existing beacon assignments
    db.run(`
        INSERT INTO beacon_zones (macAddress, zone_id, last_updated)
        SELECT b.macAddress, z.id, b.lastUpdatedTimestamp
        FROM beacons b
        JOIN hubs h ON b.bestHubId = h.id
        JOIN zones z ON h.zone_id = z.id
        WHERE b.bestHubId != 'Outside Range'
    `);

    // Update indexes
    db.run("CREATE INDEX IF NOT EXISTS idx_hubs_zone_id ON hubs(zone_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_beacon_zones_zone_id ON beacon_zones(zone_id)");

    // Recreate the view with zone-based approach
    db.run(`
        CREATE VIEW IF NOT EXISTS v_beacon_latest_rssi AS
            SELECT
                bh.macAddress,
                b.assetName,
                bh.hubId,
                z.name AS currentZone,
                bz.zone_id AS bestZoneId,
                zb.name AS assignedZone,
                bh.rssi,
                MAX(bh.timestamp) as lastSeen
            FROM
                beacon_history bh
            JOIN
                hubs h ON bh.hubId = h.id
            JOIN
                zones z ON h.zone_id = z.id
            JOIN
                beacons b ON b.macAddress = bh.macAddress
            LEFT JOIN
                beacon_zones bz ON bh.macAddress = bz.macAddress
            LEFT JOIN
                zones zb ON bz.zone_id = zb.id
            GROUP BY
                bh.macAddress, bh.hubId;
    `);
});

db.close();