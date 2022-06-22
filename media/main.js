// @ts-check

const SVG_ICONS = {
    goTo: `
            <svg version="1.1" width="16" height="16" xmlns="http://www.w3.org/2000/svg" id="goToButton">
               <path d="M 0 2 L 8 8 L 0 14 Z" />
               <path d="M 8 2 L 16 8 L 8 14 Z" />
            </svg>
        `,
    goBackTo: `
            <svg version="1.1" width="16" height="16" xmlns="http://www.w3.org/2000/svg" id="goBackToButton">
                <path d="M 16 14 L 8 8 L 16 2 Z" />
                <path d="M 8 14 L 0 8 L 8 2 Z" />
            </svg>
        `,
    startRecord: `
            <svg version="1.1" width="16" height="16" xmlns="http://www.w3.org/2000/svg" class="start">
                <circle cx="50%" cy="50%" r="7.5" fill="transparent" stroke="red" />
                <circle cx="50%" cy="50%" r="4" stroke="red" fill="red" />
            </svg>
        `,
    stopRecord: `
            <svg version="1.1" width="16" height="16" xmlns="http://www.w3.org/2000/svg" class="stop">
                <circle cx="50%" cy="50%" r="7.5" fill="transparent" stroke="red" />
                <rect x="32%" y="32%" width="6" height="6" stroke="red" fill="red"/>
            </svg>
    `
};

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    let curRecords;
    let logIndex;
    let eventTriggered;
    let maxPage;

    const pageSize = 50;
    let curPage = 1;

    const actionsElement = document.querySelector('#actions');
    if (actionsElement !== null) {
        const ul = document.createElement('ul');
        // TODO: Do not insert startRecord because it's not always.
        const li = document.createElement('li');
        li.classList.add('recordButton');
        li.innerHTML = SVG_ICONS.startRecord;
        ul.appendChild(li)

        appendListElement(ul, SVG_ICONS.goBackTo);
        appendListElement(ul, SVG_ICONS.goTo);
        actionsElement.appendChild(ul)
    }

    function appendListElement(parent, text) {
        const li = document.createElement('li');
        li.innerHTML = text;
        parent.appendChild(li)
    }

    const nextButton = document.querySelector('#nextButton')
    const prevButton = document.querySelector('#prevButton')

    nextButton.addEventListener('click', goToNextPage, false)
    prevButton.addEventListener('click', goToPrevPage, false)
    document.querySelector('.recordButton')?.addEventListener('click', startRecord, false)
    document.querySelector('#goBackToButton')?.addEventListener('click', goBackToOnce, false)
    document.querySelector('#goToButton')?.addEventListener('click', goToOnce, false)

    function update(records, logIdx) {
        curRecords = records;
        logIndex = logIdx;
        maxPage = Math.ceil(curRecords.length / pageSize);
        const targetRec = findTargetRecords()
        const index = curRecords.findIndex(rec => Object.is(rec, targetRec[0]));
        renderPage(targetRec, index);
        disableButtons();
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

    function goToNextPage() {
        if (curPage === maxPage) {
            return;
        }
        curPage += 1;
        const end = curRecords.length - (maxPage - curPage) * pageSize;
        const start = end - pageSize;
        renderPage(curRecords.slice(start, end), start)
        disableButtons();
    }

    function goToPrevPage() {
        if (curPage < 2) {
            return;
        }
        curPage -= 1
        const end = curRecords.length - (maxPage - curPage) * pageSize;
        let start = end - pageSize;
        if (start < 0) {
            start = 0;
        }
        renderPage(curRecords.slice(start, end), start)
        disableButtons();
    }

    function disableButtons() {
        prevButton.disabled = false;
        nextButton.disabled = false;
        if (curPage === maxPage) {
            nextButton.disabled = true;
        }
        if (curPage === 1) {
            prevButton.disabled = true;
        }
    }

    function startRecord() {
        if (this.querySelector('.start') !== null) {
            this.innerHTML = SVG_ICONS.stopRecord;
            vscode.postMessage({
                command: 'startRecord'
            })
        } else {
            this.innerHTML = SVG_ICONS.startRecord;
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
            div.setAttribute('data-index', recordIndex.toString())
            const indent = "\xA0".repeat(record.frame_depth);
            createTableData(`${indent}${record.name}`, div);
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
        const result = this.classList.toggle('locationShowed');
        if (!result) {
            this.nextElementSibling.remove();
            return;
        }
        const recordIdx = this.dataset.index;
        const record = curRecords[recordIdx];
        const empty = "\xA0".repeat(8);
        let cursor = record.begin_cursor;
        const parent = document.createElement('div')
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
            parent.appendChild(div);
            cursor += 1;
        })
        this.insertAdjacentElement('afterend', parent)
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
                console.log(records);
                console.log(logIndex);
                update(records, logIndex);
                vscode.setState({
                    records: records,
                    logIndex: logIndex,
                    maxPage: maxPage,
                    curPage: curPage
                })
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
        maxPage = prevState.maxPage;
        curPage = prevState.curPage;
        update(prevState.records, prevState.logIndex)
    }
}());
