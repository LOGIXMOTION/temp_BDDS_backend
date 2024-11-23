let timeTrackingInterval;
let currentData = {};
let selectedDate = null;
let loadingTimeout;

function showLoadingIndicator() {
    loadingTimeout = setTimeout(() => {
        document.getElementById('loadingIndicator').style.display = 'inline';
    }, 100);
}

function hideLoadingIndicator() {
    clearTimeout(loadingTimeout);
    document.getElementById('loadingIndicator').style.display = 'none';
}

function fetchTimeTrackingData() {
    showLoadingIndicator();
    axios.get(window.API_ENDPOINTS.TIME_TRACKING)
        .then(response => {
            const newData = response.data;
            const hasNewData = JSON.stringify(newData) !== JSON.stringify(currentData);
            
            if (hasNewData) {
                currentData = newData;
                updateDateSelector();
                createTimeTrackingTable(currentData);
            }
            hideLoadingIndicator();
        })
        .catch(error => {
            console.error('Failed to fetch time tracking data:', error);
            hideLoadingIndicator();
        });
}

function updateDateSelector() {
    const dateSelector = document.getElementById('dateSelector');
    
    const allDates = new Set();
    Object.values(currentData).forEach(person => {
        person.timeSections.forEach(section => {
            allDates.add(section.date);
        });
    });

    // Sort dates in ascending order (oldest first) based on DD.MM.YYYY format
    const sortedDates = Array.from(allDates).sort((a, b) => {
        const [dayA, monthA, yearA] = a.split('.').map(Number);
        const [dayB, monthB, yearB] = b.split('.').map(Number);
        const dateA = new Date(yearA, monthA - 1, dayA);
        const dateB = new Date(yearB, monthB - 1, dayB);
        return dateA - dateB;
    });
    
    // Only update options if there are new dates
    if (sortedDates.length !== dateSelector.options.length) {
        dateSelector.innerHTML = '';
        sortedDates.forEach(date => {
            const option = document.createElement('option');
            option.value = date;
            option.textContent = date;
            dateSelector.appendChild(option);
        });
    }

    // Select the most recent date by default, or maintain the selected date if it exists
    if (!selectedDate || !sortedDates.includes(selectedDate)) {
        // select the most recent date (which will be the last in the sorted array)
        selectedDate = sortedDates[sortedDates.length - 1];
    }
    dateSelector.value = selectedDate;
}


function createTimeTrackingTable(data) {
    const table = document.getElementById('timeTrackingTable');
    const tbody = table.getElementsByTagName('tbody')[0];

    // Clear existing content
    tbody.innerHTML = '';

    // Create header
    const headerRow = tbody.insertRow();
    ['Name', 'Session Start', 'Session Stop', 'Time Counter'].forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        headerRow.appendChild(th);
    });

    let excessiveHoursWarning = [];

    // Create data rows
    Object.entries(data).forEach(([macAddress, assetData], personIndex) => {
        let totalTime = 0;
        const filteredSections = assetData.timeSections.filter(section => section.date === selectedDate);

        if (filteredSections.length === 0) return; // Skip if no data for selected date

        filteredSections.forEach((section, index) => {
            const row = tbody.insertRow();
            row.classList.add('person-row');

            if (index === 0) {
                const nameCell = row.insertCell();
                nameCell.textContent = assetData.assetName || macAddress;
                nameCell.style.fontWeight = 'bold';
                nameCell.rowSpan = filteredSections.length + 1; // +1 for total row
            }

            row.insertCell().textContent = new Date(section.startTime).toLocaleTimeString('de-DE');
            row.insertCell().textContent = section.stopTime ? new Date(section.stopTime).toLocaleTimeString('de-DE') : '-';
            row.insertCell().textContent = section.duration;

            // Add duration to total time
            const [hours, minutes, seconds] = section.duration.split(':').map(Number);
            totalTime += hours * 3600 + minutes * 60 + seconds;
        });

        // Add total time row
        const totalRow = tbody.insertRow();
        totalRow.classList.add('person-row', 'total-row');
        totalRow.insertCell(); // Skip name cell
        const totalLabelCell = totalRow.insertCell();
        totalLabelCell.textContent = 'Total Time';
        totalLabelCell.colSpan = 2;
        const totalTimeCell = totalRow.insertCell();
        totalTimeCell.textContent = formatTotalTime(totalTime);

        // Check if total time exceeds 15 hours
        if (totalTime > 15 * 3600) {
            excessiveHoursWarning.push(assetData.assetName || macAddress);
        }

        // Add a spacer row with a thick border
        if (personIndex < Object.entries(data).length - 1) {
            const spacerRow = tbody.insertRow();
            spacerRow.classList.add('spacer-row');
            const spacerCell = spacerRow.insertCell();
            spacerCell.colSpan = 4;
        }
    });

    // Add warning for excessive hours if necessary
    if (excessiveHoursWarning.length > 0) {
        const warningRow = tbody.insertRow();
        const warningCell = warningRow.insertCell();
        warningCell.colSpan = 4;
        warningCell.style.color = 'red';
        warningCell.style.fontWeight = 'bold';
        const warningText = excessiveHoursWarning.length === 1 
            ? `${excessiveHoursWarning[0]} probably left their blukii.` 
            : `${excessiveHoursWarning.slice(0, -1).join(', ')} and ${excessiveHoursWarning.slice(-1)} probably left their blukiis.`;
        warningCell.textContent = `${warningText} The trigger for this text is >15 hours.`;
    }
}

function formatTotalTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function closeTimeTrackingPopup() {
    document.getElementById('timeTrackingPopup').style.display = 'none';
    clearInterval(timeTrackingInterval);
}

function openTimeTrackingPopup() {
    document.getElementById('timeTrackingPopup').style.display = 'block';
    fetchTimeTrackingData(); // Initial fetch
    timeTrackingInterval = setInterval(fetchTimeTrackingData, 5000); // Update every 5 seconds
}

// Add event listener to date selector
document.getElementById('dateSelector').addEventListener('change', (event) => {
    selectedDate = event.target.value;
    showLoadingIndicator();
    createTimeTrackingTable(currentData);
    hideLoadingIndicator();
});