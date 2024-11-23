import time
import requests
import json
import random
from datetime import datetime

# Hubs and Beacons Configuration
ZONES_CONFIG = [
    # {'name': 'Lionels Room', 'hubId': 'hub869B3FE0', 'weight': 1},
    # {'name': 'Karins Room', 'hubId': 'hub869CB028', 'weight': 1},
    # {'name': 'Leonardo', 'hubId': 'hub55A9DF84', 'weight': 1},
    # {'name': 'Gabys Room', 'hubId': 'hub55AA7FC4', 'weight': 1},
    {'name': 'Embedded', 'hubId': 'hub869B3540', 'weight': 1},
    # {'name': 'Zuse', 'hubId': 'hub869B3544', 'weight': 1},
    # {'name': 'Matthias\' Room', 'hubId': 'hub869CAFEC', 'weight': 1},
    # {'name': 'Softies', 'hubId': 'hub55AA6CCC', 'weight': 1},
]

# Full Name	MAC Address
# Alkhouri, Danny	B0D2781ACDD1
# Binnig, Andre	B0D2781ACDA3
# Fleig, Lennart	B0D27817DC94
# Fleig, Severin	B0D27817DCAE
# Kaltenbacher, Simon	B0D2781ACDCB
# Ketterer, Lionel	B0D27817DCB6
# Killet, Andreas	B0D27817DCB1
# Lehmann, Peter	B0D27817DCA8
# Naser, Gaby	B0D27817DCBC
# Packe, Christoph	B0D27817DC9C
# Prasobhan, Aneesh	B0D27817DA5A
# Rosshart, Jessica	B0D2781ACDA7
# Schneider, Matthias	B0D27817DCA4
# Silbersdorf, Karin	B0D27817DA64
# Dümpelmann, Max	B0D2781ACDC7 

MAIN_BLE_BEACONS = [
    'E4E1129BDC9A',
    'E4E1129BDB69',
    'E4E1129BDB75',
    'E4E1129BDE9D',
    'B09122E58408',
    'F05ECD32E5F1',
    'E4E1129C2810',
    'E4E1129C2B71',
    'B0D2781ACDD1',
    'B0D2781ACDA3',
    'B0D27817DC94',
    'B0D27817DCAE',
    'B0D2781ACDCB',
    'B0D27817DCB6',
    'B0D27817DCB1',
    'B0D27817DCA8',
    'B0D27817DCBC',
    'B0D27817DC9C',
    'B0D27817DA5A',
    'B0D2781ACDA7',
    'B0D27817DCA4',
    'B0D27817DA64',
    'B0D2781ACDC7'
    
]

API_URL = "http://localhost:3000/data"
#Server URL
# API_URL = "https://api.aneeshprasobhan.xyz/asset-tracking-api/data"

# Function to generate current epoch time in milliseconds
def current_epoch_time_ms():
    return int(time.time() * 1000)
    # return same time but for the next day
    # return int(time.time() * 1000) + 86400000



# Function to create hub data
def create_hub_data(hub, beacon):
    timestamp = current_epoch_time_ms()
    data = {
        "id": hub['hubId'],
        "items": [
            {
                "macAddress": beacon,
                # "assetName": "Max Dümpelmann",
                "blukiiId": f"blukii BXXXXX {beacon}",
                "batteryPct": random.randint(90, 100),
                "timestamp": timestamp,
                "rssi": [
                    {
                        "rssi": random.randint(-70, -30),
                        "timestamp": timestamp
                    }
                ],
                "iBeaconData": [
                    {
                        "uuid": "626C756B-6969-2E63-6F6D-626561636F6E",
                        "major": random.randint(1, 5),
                        "minor": random.randint(10000, 50000),
                        "measuredPower": -57,
                        "timestamp": timestamp
                    }
                ]
            }
        ]
    }
    return data

        
        
# Function to send data that loops through all beacons for each hub (similar to above but with all beacons)
def send_data_to_endpoint():
    for hub in ZONES_CONFIG:
        for beacon in MAIN_BLE_BEACONS:
            data = create_hub_data(hub, beacon)
            headers = {'Content-Type': 'application/json'}
            
            try:
                response = requests.post(API_URL, headers=headers, data=json.dumps(data))
                
                if response.status_code == 200:
                    print(f"Successfully sent data for {hub['name']} (Hub ID: {hub['hubId']})")
                    print(json.dumps(data, indent=4))
                else:
                    print(f"Failed to send data for {hub['name']} (Hub ID: {hub['hubId']}) - Status Code: {response.status_code}")
            except Exception as e:
                print(f"Error sending data for {hub['name']} (Hub ID: {hub['hubId']}) - {str(e)}")

            # Wait 500ms before sending the next hub's data
            time.sleep(0.1)

if __name__ == "__main__":
    send_data_to_endpoint()
