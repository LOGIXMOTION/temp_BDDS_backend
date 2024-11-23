const redis = require('redis');

console.log("Starting script...");

const client = redis.createClient();

client.on('error', function (err) {
    console.error('Error ' + err);
});

client.on('connect', function() {
    console.log('Connected to Redis');
    
    client.set('testKey', 'testValue', function(err, reply) {
        if (err) {
            console.error("Error setting value:", err);
            return;
        }
        console.log(reply); // Should print "OK"
        
        client.get('testKey', function(err, reply) {
            if (err) {
                console.error("Error getting value:", err);
                return;
            }
            console.log(reply); // Should print 'testValue'
            client.quit(); // Close the connection after we're done
        });
    });
});

console.log("Script initiated...");
