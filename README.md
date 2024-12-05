# Initial Setup  (NOT NEEDED FOR HTML ZONES DEMO, because its just a HTML PAGE with some JS)

In project folder:
`npm create vite@latest ./ -- --template react`
`npm install -D tailwindcss`
`npx tailwindcss init`
`npm install @react-three/fiber @react-three/drei maath react-parallax-tilt react-vertical-timeline-component framer-motion react-router-dom`
`npm install three`
`npm install -D postcss autoprefixer`
`npx tailwindcss init -p`

#### Import Floor Plan DXF file to Blender and make walls and doors (if you want to be fancy)

# Backend and Database setup 

-- To setup server and database, go to backend folder and run `npm install sqlite3` (if not installed already) and `node setupDatabase.js`
-- To run the server, now run `node server.js`
-- Modify the server.js file to change the database file path if needed. Here is the code:

```javascript
// let db = new sqlite3.Database('./rtls_demo.db');
//Use the following line for docker and comment the above line
let db = new sqlite3.Database('/usr/src/app/db/rtls_demo.db');
```

# Initial Frontend setup

To compile 
npm run build
npm install -g serve
go to dist folder  > also change permissions in power shell 
> Open power shell as admin and run this > 
Set-ExecutionPolicy RemoteSigned
then run the following inside distr directory >  
serve -s 

# Running Frontend

`npm run dev`

# Docker setup
## Build the Docker image
docker build --no-cache -t asset-tracking-server .

## Run the Docker container
docker run -d --name asset-tracking-server --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 -p 3001:3000 -v /home/asset-tracking:/usr/src/app -v /usr/src/app/node_modules -v /home/asset-tracking-db:/usr/src/app/db -v /home/asset-tracking-plans:/usr/src/app/plans -v /etc/localtime:/etc/localtime:ro -v /etc/timezone:/etc/timezone:ro asset-tracking-server



## Set appropriate permissions for the database file
docker exec asset-tracking-server chmod 666 /usr/src/app/db/rtls_demo.db

## Restart the Docker container to apply changes
docker restart asset-tracking-server

## Connect the Docker container to the proxy manager network
docker network connect proxy-manager_default asset-tracking-server

# Server Time setup 

To set the time to the correct time zone
`timedatactl` 

To set Timezone
`sudo timedatectl set-timezone Europe/Berlin`

To sync System Clock
`sudo timedatectl set-ntp true`

Verify the time
`timedatectl`

Should show something like this

```
Local time: Tue 2024-09-03 00:22:00 CEST
Universal time: Mon 2024-09-02 22:22:00 UTC
RTC time: Mon 2024-09-02 22:22:00
Time zone: Europe/Berlin (CEST, +0200)
System clock synchronized: yes
NTP service: active
RTC in local TZ: no
```

Then the docker run command already contains to push the host time to the container.

Ensure that the docker returns time zone Europe/Berlin with this command 
`docker exec -it asset-tracking-server printenv TZ`