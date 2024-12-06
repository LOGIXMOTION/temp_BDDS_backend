FROM node:14-buster

# Install build dependencies and SQLite3
RUN apt-get update && apt-get install -y python make g++ sqlite3 libsqlite3-dev tzdata 

WORKDIR /usr/src/app

# Create directory for the database
RUN mkdir -p /usr/src/app/db && chmod 777 /usr/src/app/db
RUN mkdir -p /usr/src/app/plans && chmod 777 /usr/src/app/plans

RUN mkdir -p /usr/src/app/plans && \
    chown -R node:node /usr/src/app/plans && \
    chmod -R 755 /usr/src/app/plans
    
# Set the timezone to Europe/Berlin
ENV TZ=Europe/Berlin

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

RUN npm install multer

# Force rebuild of sqlite3
# RUN npm rebuild sqlite3 --build-from-source

# We'll copy the application files at runtime via volume mount

EXPOSE 3000

# Install dependencies, rebuild sqlite3, and start the server at runtime
# CMD sh -c "npm install && npm rebuild sqlite3 --build-from-source && node server.js"

CMD sh -c "node server.js"