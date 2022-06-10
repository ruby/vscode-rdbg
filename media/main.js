// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const container = document.querySelector('#container');
    let currentTraces;
    const goHereText = 'GO HERE'

    const selfLabel = 'self';
    const bindingLabel  = 'binding';
    const iseqLabel = 'iseq';
    const classLabel = 'class';
    const frame_depthLabel = 'frame_depth';
    const has_return_valueLabel = 'has_return_value';
    const return_valueLabel = 'return_value';
    const has_raised_exceptionLabel = 'has_raised_exception';
    const show_lineLabel = 'show_line';
    const _local_variablesLabel = '_local_variables';
    const _calleeLabel = '_callee';
    const dupped_bindingLabel = 'dupped_binding';

    function update(records) {
        const tbody = document.querySelector('#tbody-view')
        let id = 1;
        records.forEach(record => {
            const tr = document.createElement('tr');
            tr.classList.add('frame')
            tr.setAttribute('data-id', id.toString());
            const td = document.createElement('td');
            const goHereButton = document.createElement('button');
            const text = document.createTextNode(goHereText);
            goHereButton.appendChild(text);
            goHereButton.addEventListener('click', goHere, false);
            td.appendChild(goHereButton);
            tr.appendChild(td);
            createTableData(record.name, tr);
            createTableData(record.location, tr);
            tr.addEventListener('click', () => {
                const isClosed = tr.classList.toggle('frameDetailOpen');
                if (!isClosed) {
                    tr.nextElementSibling.remove();
                    return;
                }
                const details = document.querySelector('.frameDetails')
                if (details != null) {
                    details.previousElementSibling.classList.remove('frameDetailOpen')
                    details.remove();
                }

                const frameDetails = document.createElement('tr');
                frameDetails.classList.add("frameDetails");
                const emptyTd = document.createElement('td');
                frameDetails.appendChild(emptyTd);
                const frameData = document.createElement('td');

                appendText(`${selfLabel}: ${record.self}`, frameData);
                appendText(`${bindingLabel}: ${record.binding}`, frameData);
                appendText(`${iseqLabel}: ${record.iseq}`, frameData);
                appendText(`${classLabel}: ${record.class}`, frameData);
                appendText(`${frame_depthLabel}: ${record.frameDepth}`, frameData);
                appendText(`${has_return_valueLabel}: ${record.has_return_value}`, frameData);
                appendText(`${return_valueLabel}: ${record.return_value}`, frameData);
                appendText(`${has_raised_exceptionLabel}: ${record.has_raised_exception}`, frameData);
                appendText(`${show_lineLabel}: ${record.show_line}`, frameData);
                appendText(`${_local_variablesLabel}: ${record._local_variables}`, frameData);
                appendText(`${_calleeLabel}: ${record._callee}`, frameData);
                appendText(`${dupped_bindingLabel}: ${record.dupped_binding}`, frameData);
                frameDetails.appendChild(frameData);
                tr.insertAdjacentElement('afterend', frameDetails)
            })
            tbody.appendChild(tr);
            id += 1;
        })
    };

    function goHere(e) {
        const frameSize = document.querySelectorAll('.frame').length;
        // @ts-ignore
        const tr = e.target.closest('tr');
        if (tr === null) {
            return;
        }
        const times = frameSize - parseInt(tr.dataset.id) + 1;
        vscode.postMessage({
            command: 'goHere',
            times: times,
        })
    }

    function appendText(string, element) {
        const text = document.createTextNode(string);
        const br = document.createElement('br');
        element.appendChild(text);
        element.appendChild(br);
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
                const args = data.arguments;
                currentTraces = args;
                resetView()
                update(args);
                break;
        };
    });
}());
