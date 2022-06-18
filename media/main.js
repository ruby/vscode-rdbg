// @ts-check

const SVG_ICONS = {
    goTo: `
            <svg version="1.1" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
	            <path d="M 6 5 L 16 15 L 6 25 Z" />
	            <path d="M 16 5 L 26 15 L 16 25 Z" />
            </svg>
        `,
    goBackTo: `
                <svg version="1.1" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
                    <path d="M 24 5 L 14 15 L 24 25 Z" />
                    <path d="M 14 5 L 4 15 L 14 25 Z" />
                </svg> 
    `
};

window.onload = () => {
    const containerElement = document.querySelector('#container');
    if (containerElement == null) {
        return
    }
    containerElement.insertAdjacentHTML('afterbegin', SVG_ICONS.goTo);
    containerElement.insertAdjacentHTML('afterbegin', SVG_ICONS.goBackTo);
}

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    let curRecords;
    let logIndex;
    let eventTriggered;
    let maxPage;

    const pageSize = 50;
    let curPage = 1;

    function update(records, logIdx) {
        curRecords = records;
        logIndex = logIdx;
        maxPage = Math.ceil(curRecords.length / pageSize);
        const targetRec = findTargetRecords()
        const index = curRecords.findIndex(rec => Object.is(rec, targetRec[0]));
        renderPage(targetRec, index);
    };

    function findTargetRecords() {
        const lastRec = curRecords[curRecords.length - 1];
        curPage = maxPage;
        if (logIndex > lastRec.begin_cursor + lastRec.locations.length) {
            return curRecords.slice(-pageSize)
        }
        let remainRec = curRecords
        while (remainRec.length > 1) {
            const records = remainRec.slice(-pageSize)
            const firstRec = records[0];
            const lastRec = records[records.length - 1];
            const start = firstRec.begin_cursor;
            const end = lastRec.begin_cursor + lastRec.locations.length;
            if (logIndex >= start && logIndex <= end) {
                return records
            }

            curPage -= 1
            remainRec = curRecords.slice(0, -pageSize)
        }
        return remainRec
    }

    document.querySelector('#nextButton').addEventListener('click', goToNextPage, false)
    document.querySelector('#prevButton').addEventListener('click', goToPrevPage, false)
    document.querySelector('.recordButton')?.addEventListener('click', startRecord, false)
    document.querySelector('#goBackToButton')?.addEventListener('click', goBackToOnce, false)
    document.querySelector('#goToButton')?.addEventListener('click', goToOnce, false)

    function goToNextPage() {
        if (curPage === maxPage) {
            return;
        }
        curPage += 1;
        const end = curRecords.length - 1 - (maxPage - curPage) * pageSize;
        const start = end - 50;
        renderPage(curRecords.slice(start, end), start)
    }

    function goToPrevPage() {
        if (curPage < 2) {
            return;
        }
        curPage -= 1
        const end = curRecords.length - 1 - (maxPage - curPage) * pageSize;
        const start = end - 50;
        renderPage(curRecords.slice(start, end), start)
    }

    function startRecord() {
        if (this.classList.contains('start')) {
            this.src = this.src.replace('start-record.svg', 'stop-record.svg')
            this.classList.remove('start');
            this.classList.add('stop');
            vscode.postMessage({
                command: 'startRecord'
            })
        } else {
            this.src = this.src.replace('stop-record.svg', 'start-record.svg')
            this.classList.remove('stop');
            this.classList.add('start');
            vscode.postMessage({
                command: 'stopRecord'
            })
        }
    }

    function goBackToOnce() {
        vscode.postMessage({
            command: 'goBackTo',
            times: 1
        })
    }

    function goToOnce() {
        vscode.postMessage({
            command: 'goTo',
            times: 1
        })
    }

    function renderPage(records, id) {
        resetView();
        const tbody = document.querySelector('#frames');
        let recordIndex = id;
        let clickable = true;
        records.forEach((record) => {
            const div = document.createElement('div');
            div.classList.add('frame')
            div.setAttribute('data-index', recordIndex.toString());
            createTableData(record.name, div);
            div.addEventListener('click', showLocations, false);
            tbody.appendChild(div);
            if (clickable && record.begin_cursor + record.locations.length > logIndex) {
                div.click();
                clickable = false;
            }
            recordIndex += 1;
        })
    }

    let currentStoppedCursor = null;

    function showLocations() {
        const locations = document.querySelectorAll('.location')
        if (locations.length > 0) {
            const frame = locations[0].previousElementSibling
            if (frame == this) {
                return
            }
        }
        this.classList.add('locationShowed');
        const recordIdx = this.dataset.index;
        const record = curRecords[recordIdx];
        const empty = "\xA0".repeat(8);
        let cursor = record.begin_cursor;
        let nextElement = this;
        record.locations.forEach((loc) => {
            const div = document.createElement('div');
            div.classList.add('location');
            div.setAttribute('data-cursor', cursor);
            createTableData(`${empty}${loc}`, div);
            div.addEventListener('click', goHere, false);
            if (cursor === logIndex) {
                div.classList.add('stopped');
                currentStoppedCursor = cursor;
            }
            nextElement.insertAdjacentElement('afterend', div);
            nextElement = div;
            cursor += 1;
        })
    }


    function goHere() {
        if (this.classList.contains('stopped') || eventTriggered) {
            return;
        }
        eventTriggered = true;

        const lastRecord = curRecords[curRecords.length - 1];
        const currentIndex = currentStoppedCursor || lastRecord.begin_cursor + lastRecord.locations.length;

        let times = currentIndex - parseInt(this.dataset.cursor);
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
        const frames = document.querySelector('#frames');
        frames.innerHTML = '';
    }

    function createTableData(data, parent) {
        const div = document.createElement('div');
        const text = document.createTextNode(data);
        div.appendChild(text);
        parent.appendChild(div);
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

    document.addEventListener('keydown', bindShortcut, false)

    function bindShortcut(e) {
        switch (e.key) {
            case 'ArrowDown':
                focusDownElement();
                break;
            case 'ArrowUp':
                focusUpElement();
                break;
            case 'ArrowRight':
                focusRightElement();
                break;
            case 'ArrowLeft':
                break;
        }
    }

    const focusedName = 'focused'

    function focusDownElement() {
        const focused = document.querySelector('.focused');
        if (focused === null) {
            const firstFrame = document.querySelector('.frame');
            if (firstFrame == null) {
                return;
            }
            firstFrame.classList.add(focusedName);
        } else {
            if (focused.nextElementSibling !== null) {
                focused.classList.remove(focusedName);
                focused.nextElementSibling.classList.add(focusedName);
            }
        }
    }

    function focusUpElement() {
        const focused = document.querySelector('.focused');
        if (focused === null) {
            const firstFrame = document.querySelector('.frame');
            if (firstFrame == null) {
                return;
            }
            firstFrame.classList.add(focusedName);
        } else {
            if (focused.previousElementSibling !== null) {
                focused.classList.remove(focusedName);
                focused.previousElementSibling.classList.add(focusedName);
            }
        }
    }

    function focusRightElement() {
        const focused = document.querySelector('.focused');
        if (focused === null) {
            return;
        }
        focused.click()
    }

    const prevState = vscode.getState()
    if (prevState) {
        update(prevState.records, prevState.logIndex)
    }
}());
