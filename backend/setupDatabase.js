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
    // First drop the view since it depends on the hubs table
    db.run("DROP VIEW IF EXISTS v_beacon_latest_rssi", (err) => {
        if (err) console.error('Error dropping view:', err.message);
    });

    // Create new hubs table
    db.run(`
        CREATE TABLE IF NOT EXISTS hubs_new (
            id TEXT PRIMARY KEY,
            zone TEXT,
            latitude REAL,
            longitude REAL,
            height REAL,
            weight REAL,
            orientation_angle REAL,
            tilt_angle REAL,
            zone_vertices TEXT,
            zone_color TEXT,
            zone_opacity REAL,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
    `, (err) => {
        if (err) console.error('Error creating hubs_new:', err.message);
    });

    // Copy data from old hubs table if it exists
    db.run(`
        INSERT OR IGNORE INTO hubs_new (id, zone)
        SELECT id, zone FROM hubs WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='hubs')
    `, (err) => {
        if (err) console.error('Error copying data:', err.message);
    });

    // Drop old hubs table and rename new one
    db.run(`DROP TABLE IF EXISTS hubs`, (err) => {
        if (err) console.error('Error dropping old table:', err.message);
    });

    db.run(`ALTER TABLE hubs_new RENAME TO hubs`, (err) => {
        if (err) console.error('Error renaming table:', err.message);
    });

    // Create other necessary tables
    db.run(`CREATE TABLE IF NOT EXISTS beacons (
        macAddress TEXT PRIMARY KEY, 
        bestHubId TEXT, 
        lastUpdatedTimestamp INTEGER, 
        assetName TEXT
    )`, (err) => {
        if (err) console.error('Error creating beacons table:', err.message);
    });

    db.run(`CREATE TABLE IF NOT EXISTS beacon_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        macAddress TEXT, 
        rssi INTEGER, 
        hubId TEXT, 
        timestamp INTEGER
    )`, (err) => {
        if (err) console.error('Error creating beacon_history table:', err.message);
    });

    db.run(`CREATE TABLE IF NOT EXISTS assets (
        macAddress TEXT PRIMARY KEY,
        assetName TEXT,
        humanFlag BOOLEAN
    )`, (err) => {
        if (err) console.error('Error creating assets table:', err.message);
    });

    db.run(`CREATE TABLE IF NOT EXISTS time_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        macAddress TEXT,
        assetName TEXT,
        startTimeSection INTEGER,
        stopTimeSection INTEGER,
        timeCounter TEXT,
        UNIQUE(date, macAddress, startTimeSection)
    )`, (err) => {
        if (err) console.error('Error creating time_tracking table:', err.message);
    });

    // Create indexes
    db.run("CREATE INDEX IF NOT EXISTS idx_mac_hub ON beacon_history(macAddress, hubId)", (err) => {
        if (err) console.error('Error creating idx_mac_hub:', err.message);
    });

    db.run("CREATE INDEX IF NOT EXISTS idx_timestamp ON beacon_history(timestamp)", (err) => {
        if (err) console.error('Error creating idx_timestamp:', err.message);
    });

    db.run("CREATE INDEX IF NOT EXISTS idx_time_tracking_date_mac ON time_tracking(date, macAddress)", (err) => {
        if (err) console.error('Error creating idx_time_tracking_date_mac:', err.message);
    });

    db.run("CREATE INDEX IF NOT EXISTS idx_time_tracking_order ON time_tracking(date DESC, macAddress, startTimeSection)", (err) => {
        if (err) console.error('Error creating idx_time_tracking_order:', err.message);
    });

    db.run("CREATE INDEX IF NOT EXISTS idx_hubs_zone ON hubs(zone)", (err) => {
        if (err) console.error('Error creating idx_hubs_zone:', err.message);
    });

    db.run("CREATE INDEX IF NOT EXISTS idx_hubs_updated ON hubs(updated_at)", (err) => {
        if (err) console.error('Error creating idx_hubs_updated:', err.message);
    });

    // Recreate the view after all tables are set up
    db.run(`CREATE VIEW IF NOT EXISTS v_beacon_latest_rssi AS
    SELECT
        bh.macAddress,
        b.assetName,
        bh.hubId,
        COALESCE(h.zone, 'Outside Range') AS currentZone,
        b.bestHubId,
        COALESCE(hb.zone, 
            CASE 
                WHEN b.bestHubId = 'Outside Range' THEN 'Outside Range'
                ELSE 'Outside Range'
            END
        ) AS assignedZone,
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
        bh.macAddress, bh.hubId;
    `, (err) => {
        if (err) console.error('Error creating view:', err.message);
        else console.log('Database setup completed successfully.');
    });
});

// Close the database connection
db.close((err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Closed the database connection.');
});