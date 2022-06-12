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
        let recordId = id;
        records.forEach((record, index) => {
            const tr = document.createElement('tr');
            tr.classList.add('frame')
            tr.setAttribute('data-index', recordId.toString());
            createTableData(record.name, tr);
            tr.addEventListener('click', showLocations, false);
            tbody.appendChild(tr);
        })
    }

    function showLocations() {
        const record = curRecords[this.dataset.index];
        record.locations.forEach((loc, index) => {
            const tr = document.createElement('tr');
            createTableData(loc, tr);
            tr.addEventListener('click', goHere, false);
            if (index == logIndex) {
                tr.classList.add('stopped');
            }
            this.insertAdjacentElement('afterend', tr);
        })
    }

    function goHere() {
        if (this.classList.contains('stopped') || eventTriggered) {
            return;
        }
        eventTriggered = true;
        const currentStopped = document.querySelector('.stopped')

        let currentId = curRecords.length + 1;
        if (currentStopped != null) {
            // @ts-ignore
            currentId = currentStopped.dataset.id
            currentStopped.classList.remove('.stopped')
        }

        let times = currentId - parseInt(this.dataset.id);
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
    }

    function resetView() {
        const tbody = document.querySelector('#tbody-view');
        tbody.innerHTML = '';
    }

    function createTableData(data, parent) {
        const td = document.createElement('td');
        td.setAttribute("align", "center");
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
