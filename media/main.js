// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const main = document.querySelector('#main');

    function update(traces) {
        traces.forEach(trace => {
            const tr = document.createElement('tr');
            const inputElement = document.createElement('input');
            inputElement.setAttribute('type', 'checkbox');
            tr.appendChild(inputElement);
            createTableData(trace.thread_id, tr);
            createTableData(trace.event, tr);
            createTableData(trace.method, tr);
            createTableData(`${trace.file_name}:${trace.line_number}`, tr);
            if (trace.return_value != undefined) {
                createTableData(trace.return_value, tr);
            }
            main.appendChild(tr);
        })
    };

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
                update(args);
                break;
        };
    });
}());
