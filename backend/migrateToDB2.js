const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./rtls_demo.db');

function runMigration() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            try {
                // 0. First drop the dependent view
                db.run("DROP VIEW IF EXISTS v_beacon_latest_rssi", (err) => {
                    if (err) console.error('Error dropping view:', err);
                });

                // 1. Create new zones table
                db.run(`CREATE TABLE IF NOT EXISTS zones (
                    zoneName TEXT PRIMARY KEY,
                    vertices TEXT,
                    color TEXT,
                    opacity REAL,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    updated_at INTEGER DEFAULT (strftime('%s','now'))
                )`, (err) => {
                    if (err) console.error('Error creating zones table:', err);
                });

                // 2. Create temporary hubs table
                db.run(`CREATE TABLE hubs_new (
                    id TEXT PRIMARY KEY,
                    zoneName TEXT REFERENCES zones(zoneName),
                    weight REAL DEFAULT 1.0,
                    created_at INTEGER DEFAULT (strftime('%s','now')),
                    updated_at INTEGER DEFAULT (strftime('%s','now'))
                )`, (err) => {
                    if (err) console.error('Error creating hubs_new table:', err);
                });

                // 3. Create temporary beacons table
                db.run(`CREATE TABLE beacons_new (
                    macAddress TEXT PRIMARY KEY,
                    bestZone TEXT,
                    lastUpdatedTimestamp INTEGER,
                    assetName TEXT
                )`, (err) => {
                    if (err) console.error('Error creating beacons_new table:', err);
                });

                // 4. Migrate existing zones from hubs to zones table
                db.run(`INSERT INTO zones (zoneName, vertices, color, opacity)
                    SELECT DISTINCT zone, zone_vertices, zone_color, zone_opacity 
                    FROM hubs WHERE zone IS NOT NULL`, (err) => {
                    if (err) console.error('Error migrating zones:', err);
                });

                //  (zones migration)
                db.get("SELECT COUNT(*) as count FROM zones", [], (err, row) => {
                    if (err || row.count === 0) {
                        throw new Error('Zone migration failed');
                    }
                }); 


                // 5. Migrate hub data
                db.run(`INSERT INTO hubs_new (id, zoneName, weight)
                    SELECT id, zone, weight FROM hubs`, (err) => {
                    if (err) console.error('Error migrating hubs:', err);
                });

                // 6. Migrate beacon data
                db.run(`INSERT INTO beacons_new (macAddress, bestZone, lastUpdatedTimestamp, assetName)
                    SELECT b.macAddress, 
                           CASE 
                               WHEN b.bestHubId = 'Outside Range' THEN 'Outside Range'
                               ELSE (SELECT zone FROM hubs WHERE id = b.bestHubId)
                           END,
                           b.lastUpdatedTimestamp,
                           b.assetName
                    FROM beacons b`, (err) => {
                    if (err) console.error('Error migrating beacons:', err);
                });

                // 7. Drop old tables and rename new ones
                db.run(`DROP TABLE IF EXISTS hubs`, (err) => {
                    if (err) console.error('Error dropping hubs table:', err);
                });
                db.run(`DROP TABLE IF EXISTS beacons`, (err) => {
                    if (err) console.error('Error dropping beacons table:', err);
                });
                db.run(`ALTER TABLE hubs_new RENAME TO hubs`, (err) => {
                    if (err) console.error('Error renaming hubs table:', err);
                });
                db.run(`ALTER TABLE beacons_new RENAME TO beacons`, (err) => {
                    if (err) console.error('Error renaming beacons table:', err);
                });

                // 8. Recreate the view with updated schema
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
                        bh.macAddress, bh.hubId`, (err) => {
                    if (err) {
                        console.error('Error creating view:', err);
                        reject(err);
                    } else {
                        console.log("Migration completed successfully");
                        resolve();
                    }
                });

                // Add after table creations
                db.run("CREATE INDEX IF NOT EXISTS idx_hubs_zone ON hubs(zoneName)");
                db.run("CREATE INDEX IF NOT EXISTS idx_beacons_zone ON beacons(bestZone)");

            } catch (err) {
                reject(err);
            }
        });
    });
}

// Run the migration
runMigration()
    .then(() => {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
                process.exit(1);
            }
            console.log('Database connection closed');
            process.exit(0);
        });
    })
    .catch((err) => {
        console.error('Migration failed:', err);
        db.close(() => process.exit(1));
    });

// Handle process termination
process.on('SIGINT', () => {
    db.close(() => {
        console.log('Database connection closed through SIGINT');
        process.exit(0);
    });
});