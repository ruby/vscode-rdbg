// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const historyContainer = document.querySelector('#main');

    /**
     * @param {string} json
     */
    function update(json) {
        if (historyContainer === null) {
            return;
        }
        const obj = JSON.parse(json);
        const individualHistory = document.createElement('tr');
        individualHistory.classList.add('history');
        const childElement = document.createElement('td');
        const text = document.createTextNode(obj.name);
        childElement.appendChild(text);
        individualHistory.appendChild(childElement);
        historyContainer.appendChild(individualHistory);
        individualHistory.addEventListener('click', () => {
            const opened = document.querySelector('.historyDetails');
            if (opened) {
                opened.remove();
            }
            if (individualHistory.classList.contains('opened')) {
                individualHistory.classList.remove('opened');
                return;
            }
            individualHistory.classList.add('opened')
            const historyDetails = document.createElement('tr');
            historyDetails.classList.add('historyDetails')
            const pathContainer = createElement("Path: ", obj.path, 'path');
            pathContainer.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'didClick',
                    arguments: json
                });
            })
            historyDetails.appendChild(pathContainer);
            const lineContainer = createElement("Line: ", obj.line, 'line');
            historyDetails.appendChild(lineContainer);
            const reasonContainer = createElement("Reason: ", obj.reason, 'reason');
            historyDetails.appendChild(reasonContainer);
            individualHistory.after(historyDetails);
        });
        historyContainer.appendChild(individualHistory);
    };

    /**
     * @param {string} className
     * @param {string} category
     * @param {string} value
     */
    function createElement(category, value, className) {
        const childElement = document.createElement('div');
        childElement.classList.add(className);
        const categoryElemenent = document.createElement('b');
        const categoryText = document.createTextNode(category);
        categoryElemenent.appendChild(categoryText);
        childElement.appendChild(categoryElemenent);
        const valueText = document.createTextNode(value);
        childElement.appendChild(valueText);
        return childElement;
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
