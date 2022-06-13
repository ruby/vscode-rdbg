// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    let curRecords;
    let logIndex;
    let eventTriggered;

    const pageSize = 50;
    let curPage = 1;

    function update(records, index) {
        curRecords = records;
        logIndex = index;
        renderPage(curRecords.slice(0, pageSize), 0);
    };

    document.querySelector('#nextButton').addEventListener('click', goToNextPage, false)
    document.querySelector('#prevButton').addEventListener('click', goToPrevPage, false)

    function goToNextPage() {
        curPage += 1;
        const start = (curPage - 1) * pageSize;
        if (curRecords.length < start) {
            return;
        }
        const end = curPage * pageSize;
        renderPage(curRecords.slice(start, end), start)
    }

    function goToPrevPage() {
        if (curPage - 1 < 1) {
            return;
        }
        curPage -= 1
        const start = (curPage - 1) * pageSize;
        const end = curPage * pageSize;
        renderPage(curRecords.slice(start, end), start)
    }

    function renderPage(records, id) {
        resetView();
        const tbody = document.querySelector('#tbody-view');
        let recordIndex = id;
        records.forEach((record) => {
            const tr = document.createElement('tr');
            tr.classList.add('frame')
            tr.setAttribute('data-index', recordIndex.toString());
            createTableData(record.name, tr);
            tr.addEventListener('click', showLocations, false);
            tbody.appendChild(tr);
            recordIndex += 1;
        })
    }

    function showLocations() {
        const locations = document.querySelectorAll('.location')
        if (locations.length > 0) {
            const frame = locations[0].previousElementSibling
            frame.classList.remove('locationsShowed');
            locations.forEach(loc => {
                loc.remove();
            });
            if (frame == this) {
                return
            }
        }
        this.classList.add('locationShowed');
        const recordIdx = this.dataset.index;
        const record = curRecords[recordIdx];
        const empty = "\xA0".repeat(8);
        let cursor = record.cursor;
        let nextElement = this;
        record.locations.forEach((loc) => {
            const tr = document.createElement('tr');
            tr.classList.add('location');
            tr.setAttribute('data-cursor', cursor);
            createTableData(`${empty}${loc}`, tr);
            tr.addEventListener('click', goHere, false);
            if (cursor == logIndex) {
                tr.classList.add('stopped');
            }
            nextElement.insertAdjacentElement('afterend', tr);
            nextElement = tr;
            cursor += 1;
        })
    }

    let currentStoppedCursor = null;

    function goHere() {
        if (this.classList.contains('stopped') || eventTriggered) {
            return;
        }
        eventTriggered = true;

        const lastRecord = curRecords[curRecords.length - 1];
        const currentId = currentStoppedCursor || lastRecord.cursor + lastRecord.locations.length - 1;

        let times = currentId - parseInt(this.dataset.cursor);
        var command;
        if (times > 0) {
            command = 'goBackTo';
        } else {
            command = 'goTo';
            times = Math.abs(times);
        }
        vscode.postMessage({
            command: command,
            times: times
        })
        currentStoppedCursor = this.dataset.cursor;
    }

    function resetView() {
        const tbody = document.querySelector('#tbody-view');
        tbody.innerHTML = '';
    }

    function createTableData(data, parent) {
        const td = document.createElement('td');
        const text = document.createTextNode(data);
        td.appendChild(text);
        parent.appendChild(td);
    }

    window.addEventListener('message', event => {
        const data = event.data;
        switch (data.command) {
            case 'update':
                eventTriggered = false;
                const records = data.records;
                const logIndex = data.logIndex;
                curPage = 1;
                vscode.setState({
                    records: records,
                    logIndex: logIndex
                })
                update(records, logIndex);
                break;
        };
    });

    const prevState = vscode.getState()
    if (prevState) {
        update(prevState.records, prevState.logIndex)
    }
}());
