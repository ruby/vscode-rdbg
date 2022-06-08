// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const container = document.querySelector('#container');
    let currentTraces;
    const mainString = 'main'
    const sequenceDeclaration = 'sequenceDiagram'

    const config = {
        startOnLoad: false,
        theme: 'dark',
        maxTextSize: 90000
    }
    // @ts-ignore
    mermaid.mermaidAPI.initialize(config);
    let previousHTML

    let svgElement;
    let zoom;
    container.addEventListener('click', (e) => {
        switch (e.target.id) {
            case 'visualizeButton': {
                let graphDefinition = `${sequenceDeclaration}\n`
                let tbody = document.querySelector('#tbody-view')
                for (let i = 0; i < tbody.childElementCount; i ++) {
                    let input = tbody.children[i].querySelector('input')
                    if (input && input.checked) {
                        let trace = currentTraces[i];
                        if (trace.return_value == undefined) {
                            graphDefinition += mainString;
                            graphDefinition += '->>';
                            graphDefinition += trace.method;
                            graphDefinition += ': ';
                        } else {
                            graphDefinition += trace.method;
                            graphDefinition += '->>';
                            graphDefinition += mainString;
                            graphDefinition += ': ';
                            graphDefinition += escapeCharacters(trace.return_value);
                        }
                        graphDefinition += '\n';
                    }
                }
                if (graphDefinition == `${sequenceDeclaration}\n`) {
                    graphDefinition += `participant ${mainString}\n`
                }
                let insertSvg = (/** @type {string} */ svgGraph) => {
                    previousHTML = container.innerHTML;
                    container.innerHTML = svgGraph;
                    let resetButton = document.createElement('button');
                    resetButton.id = 'resetButton';
                    let reset = document.createTextNode('Reset');
                    resetButton.appendChild(reset);
                    container.appendChild(resetButton);
                    let backButton = document.createElement('button');
                    backButton.id = 'backButton'
                    let back = document.createTextNode('< Back');
                    backButton.appendChild(back);
                    container.prepend(backButton);
                };
                 // @ts-ignore
                mermaid.mermaidAPI.render('id-1', graphDefinition, insertSvg);
                // @ts-ignore
                svgElement = d3.select('svg');
                let html = `<g>${svgElement.html()}</g>`;
                svgElement.html(html)
                let g = svgElement.select('g');
                // @ts-ignore
                zoom = d3.zoom()
                    .scaleExtent([1, 30])
                    .on("zoom", ({transform}) => {
                        g.attr("transform", transform);
                    })
                svgElement.call(zoom);
                break;
            }
            case 'backButton': {
                container.textContent = '';
                container.insertAdjacentHTML('afterbegin', previousHTML);
                break;
            }
            case 'resetButton': {
                if (zoom == undefined || svgElement == undefined) {
                    break;
                }

                // @ts-ignore
                d3.select('svg').transition()
                    .duration(750)
                    // @ts-ignore
                    .call(zoom.transform, d3.zoomIdentity);
                break;
            }
        };
    })

    function update(traces) {
        const tbody = document.querySelector('#tbody-view')
        traces.forEach(trace => {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            const inputElement = document.createElement('input');
            inputElement.setAttribute('type', 'checkbox');
            td.appendChild(inputElement)
            tr.appendChild(td);
            createTableData(trace.thread_id, tr);
            createTableData(trace.event, tr);
            createTableData(trace.method, tr);
            createTableData(`${trace.file_name}:${trace.line_number}`, tr);
            if (trace.return_value != undefined) {
                createTableData(trace.return_value, tr);
            }
            tbody.appendChild(tr);
        })
    };

    function escapeCharacters(str) {
        return str
            .replace('#', '#9839;')
            .replace('<', '#lt;')
            .replace('>', '#gt;')
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
