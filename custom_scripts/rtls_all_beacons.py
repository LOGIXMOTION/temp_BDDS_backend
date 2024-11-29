import time
import requests
import json
import random
from datetime import datetime, timedelta


# Hubs configuration
ZONES_CONFIG = [
    {'name': 'Lionels Room', 'hubId': 'hub869B3FE0', 'weight': 1},
    {'name': 'Karins Room', 'hubId': 'hub869CB028', 'weight': 1},
    {'name': 'Leonardo', 'hubId': 'hub55A9DF84', 'weight': 1},
    {'name': 'Gabys Room', 'hubId': 'hub86C24FEC', 'weight': 1},
    {'name': 'Embedded', 'hubId': 'hub869B3540', 'weight': 1},
    {'name': 'Zuse', 'hubId': 'hub869B3584', 'weight': 1},
    {'name': 'Matthias\' Room', 'hubId': 'hub869CAFEC', 'weight': 1},
    {'name': 'Softies', 'hubId': 'hub55AA6CCC', 'weight': 1},
    # {'name': 'Lionels New Room', 'hubId': 'hub869B3FE0', 'weight': 1},
]

# Main BLE beacons
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
    'B0D2781ACDC7',
    'B0D2781ACCCC',
    'E4E1129BDDDD',
    # 'B12345678912'
]

# API endpoint
endpoint_url = "https://api.aneeshprasobhan.xyz/asset-tracking-api/data"
# For local testing
# endpoint_url = "http://localhost:3000/asset-tracking-api/data"

def create_json_data_for_all_beacons(hub):
        # current_timestamp = int((datetime.now() + timedelta(days=5)).timestamp() * 1000)

    # Calculate the current timestamp 3 hours behind the current time
    # current_timestamp = int((datetime.now() - timedelta(hours=3)).timestamp() * 1000)
    #return current_timestamp
    current_timestamp = int((datetime.now()).timestamp() * 1000)
    # current_timestamp = 1725141590000; 
    items = []
    for beacon in MAIN_BLE_BEACONS:
        item = {
            "macAddress": beacon,
            "blukiiId": f"blukii BXXXXX {beacon}",
            "batteryPct": random.randint(90, 100),
            "timestamp": current_timestamp,
            "rssi": [
                {
                    "rssi": random.randint(-70, -30),
                    # fixed rssi value for testing
                    # "rssi": -55,
                    # "rssi": -40,
                    "timestamp": current_timestamp
                }
            ],
            "iBeaconData": [
                {
                    "uuid": "626C756B-6969-2E63-6F6D-626561636F6E",
                    "major": random.randint(1, 5),
                    "minor": random.randint(10000, 50000),
                    "measuredPower": -57,
                    "timestamp": current_timestamp
                }
            ]
        }
        items.append(item)
    
    json_data = {
        "id": hub['hubId'],
        "items": items
    }
    return json_data

def send_data_to_endpoint():
    for hub in ZONES_CONFIG:
        json_data = create_json_data_for_all_beacons(hub)
        response = requests.post(endpoint_url, json=json_data)
        if response.status_code == 200:
            print(f"Data sent successfully for {hub['name']}")
        else:
            print(f"Failed to send data for {hub['name']}. Status Code: {response.status_code}")
        time.sleep(0.1)  # Wait for 500ms before sending the next hub's data

if __name__ == "__main__":
    send_data_to_endpoint()
