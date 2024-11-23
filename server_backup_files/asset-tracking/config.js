const ZONES_CONFIG = [
  { name: 'Lionels Room', hubId: 'hub869B3FE0', weight: 1 },
  { name: 'Karins Room', hubId: 'hub869CB028', weight: 1 },
  { name: 'Leonardo', hubId: 'hub55A9DF84', weight: 1 },
  { name: 'Gabys Room', hubId: 'hub55AA7FC4', weight: 1 },
  { name: 'Embedded', hubId: 'hub869B3540', weight: 1 },
  { name: 'Zuse', hubId: 'hub869B3544', weight: 1 },
  { name: 'Matthias\' Room', hubId: 'hub869CAFEC', weight: 1 },
  { name: 'Softies', hubId: 'hub55AA6CCC', weight: 1 },
  { name: 'Outside Range', hubId: 'Outside Range', weight: 1 }
];

const MAIN_BLE_BEACONS = [
  { macAddress: 'E4E1129BDC9A', assetName: null, humanFlag: false },
  { macAddress: 'E4E1129BDB69', assetName: null, humanFlag: false },
  { macAddress: 'E4E1129BDB75', assetName: null, humanFlag: false },
  { macAddress: 'E4E1129BDE9D', assetName: null, humanFlag: false },
  { macAddress: 'B09122E58408', assetName: null, humanFlag: false },
  { macAddress: 'F05ECD32E5F1', assetName: null, humanFlag: false },
  { macAddress: 'E4E1129C2810', assetName: null, humanFlag: false },
  { macAddress: 'E4E1129C2B71', assetName: null, humanFlag: false },
  { macAddress: 'B0D2781ACDD1', assetName: 'Danny Alkhouri', humanFlag: true},
  { macAddress: 'B0D2781ACDA3', assetName: 'Andre Binnig', humanFlag: true},
  { macAddress: 'B0D27817DC94', assetName: 'Lennart Fleig', humanFlag: true},
  { macAddress: 'B0D27817DCAE', assetName: 'Severin Fleig', humanFlag: true},
  { macAddress: 'B0D2781ACDCB', assetName: 'Simon Kaltenbacher', humanFlag: true},
  { macAddress: 'B0D27817DCB6', assetName: 'Lionel Ketterer', humanFlag: true},
  { macAddress: 'B0D27817DCB1', assetName: 'Andreas Killet', humanFlag: true},
  { macAddress: 'B0D27817DCA8', assetName: 'Peter Lehmann', humanFlag: true},
  { macAddress: 'B0D27817DCBC', assetName: 'Gaby Naser', humanFlag: true},
  { macAddress: 'B0D27817DC9C', assetName: 'Christoph Packe', humanFlag: true},
  { macAddress: 'B0D27817DA5A', assetName: 'Aneesh Prasobhan', humanFlag: true},
  { macAddress: 'B0D2781ACDA7', assetName: 'Jessica Rosshart', humanFlag: true},
  { macAddress: 'B0D27817DCA4', assetName: 'Matthias Schneider', humanFlag: true},
  { macAddress: 'B0D27817DA64', assetName: 'Karin Silbersdorf', humanFlag: true},
  { macAddress: 'B0D2781ACDC7', assetName: 'Max Dümpelmann', humanFlag: true},
];

// Generate HUB_TO_ZONE and HUB_WEIGHTS from ZONES_CONFIG
const HUB_TO_ZONE = ZONES_CONFIG.reduce((acc, zone) => {
  acc[zone.hubId] = zone.name;
  return acc;
}, {});

const HUB_WEIGHTS = ZONES_CONFIG.reduce((acc, zone) => {
  acc[zone.hubId] = zone.weight;
  return acc;
}, {});

module.exports = { ZONES_CONFIG, MAIN_BLE_BEACONS, HUB_TO_ZONE, HUB_WEIGHTS };