// Utility to generate unique IDs
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Global State
let clipboardData = { nodes: [], edges: [] };
let state = {
    pages: [], // { id, title, settings }
    nodes: [], // { id, x, y, type, title, description, parentId, pageId, completed, textAlign, width, height }
    edges: [], // { id, source, target }
    theme: 'light',
    settings: {
        customColors: { light: {}, dark: {} }
    }
};

// History State
const MAX_HISTORY = 50;
let historyStack = [];
let historyIndex = -1;
let isUndoAction = false;

// UI State
let uiState = {
    activePageId: null,
    currentCanvasId: null, // null means root of activePageId
    selectedNodeIds: new Set(),
    selectedEdgeId: null,
    canvasOffset: { x: 0, y: 0 },
    zoom: 1,
    isDraggingNode: false,
    hasDragged: false,
    dragNodeId: null,
    isConnecting: false,
    connectSourceId: null,
    connectSourcePort: null,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    isSelecting: false,
    selectStart: { x: 0, y: 0 },
    isResizing: false,
    resizeNodeId: null,
    dragExtraIds: new Set(),
    draggedEdgeId: null,
    draggedEdgeType: null,
    isDraggingLabel: false,
    draggedLabelId: null
};

let canvasContextMenuLocation = { x: 0, y: 0 };

// DOM Elements
const workspace = document.getElementById('workspace');
const nodesContainer = document.getElementById('nodes-container');
const labelsContainer = document.getElementById('labels-container');
const edgesGroup = document.getElementById('edges-group');
const drawingEdge = document.getElementById('drawing-edge');
const selectionBox = document.getElementById('selection-box');
const contextMenu = document.getElementById('context-menu');
const detailsSidebar = document.getElementById('details-sidebar');
const sidebarLeft = document.getElementById('sidebar');
const themeToggle = document.getElementById('theme-toggle');
const breadcrumbTrail = document.getElementById('bc-trail');
const bcHome = document.getElementById('bc-home');

const minimapContent = document.getElementById('minimap-content');
const minimapViewport = document.getElementById('minimap-viewport');

const pagesList = document.getElementById('pages-list');

// Initialization
function init() {
    loadState();
    historyStack.push(JSON.stringify(state));
    historyIndex = 0;
    applyTheme(state.theme);
    renderPagesList();
    renderBreadcrumbs();
    renderAll();
    setupEventListeners();
    updateSidebarUI();
}

// State Management
function saveState() {
    localStorage.setItem('grimoire_state_v3', JSON.stringify(state));
    
    if (!isUndoAction) {
        if (historyIndex < historyStack.length - 1) {
            historyStack = historyStack.slice(0, historyIndex + 1);
        }
        historyStack.push(JSON.stringify(state));
        if (historyStack.length > MAX_HISTORY) {
            historyStack.shift();
        } else {
            historyIndex++;
        }
    }
}

function loadState() {
    const savedV3 = localStorage.getItem('grimoire_state_v3');
    const savedV2 = localStorage.getItem('grimoire_state_v2');
    const saved = savedV3 || savedV2 || localStorage.getItem('grimoire_state');
    
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.theme = parsed.theme || 'light';
            state.edges = parsed.edges || [];
            state.settings = parsed.settings || { customColors: { light: {}, dark: {} } };
            
            if (parsed.pages && parsed.pages.length > 0) {
                state.pages = parsed.pages.map(p => {
                    if (!p.settings) {
                        p.settings = { subtasksPerRow: 1, defaultAlignment: 'center', gridSize: 40, snapToGrid: false };
                    }
                    return p;
                });
            } else {
                state.pages = [{ 
                    id: 'default-page', 
                    title: 'Main Workspace',
                    settings: { subtasksPerRow: 1, defaultAlignment: 'center', gridSize: 40, snapToGrid: false }
                }];
            }
            
            uiState.activePageId = state.pages[0].id;

            // Migrate nodes
            state.nodes = parsed.nodes || [];
            state.nodes.forEach(n => {
                if (n.parentId === undefined) n.parentId = null;
                if (n.completed === undefined) n.completed = false;
                if (n.textAlign === undefined) n.textAlign = 'center';
                if (!n.pageId) n.pageId = 'default-page'; // Assign orphaned nodes
            });
            
        } catch (e) {
            console.error("Failed to load state", e);
            setupDefaultState();
        }
    } else {
        setupDefaultState();
    }
}

function setupDefaultState() {
    state.pages = [{ 
        id: 'default-page', 
        title: 'Main Workspace',
        settings: { subtasksPerRow: 1, defaultAlignment: 'center', gridSize: 40, snapToGrid: false }
    }];
    state.settings = { customColors: { light: {}, dark: {} } };
    uiState.activePageId = 'default-page';
}

// Pages Logic
function renderPagesList() {
    pagesList.innerHTML = '';
    
    state.pages.forEach((page, index) => {
        const el = document.createElement('div');
        el.className = `page-item ${page.id === uiState.activePageId ? 'active' : ''}`;
        el.draggable = true;
        
        el.innerHTML = `
            <div class="page-item-title" contenteditable="false">${page.title}</div>
            <div class="page-actions">
                <button class="page-action-btn edit-btn" title="Rename">✎</button>
                <button class="page-action-btn danger delete-btn" title="Delete">✕</button>
            </div>
        `;
        
        // Switch page
        el.addEventListener('click', (e) => {
            if (e.target.closest('.page-actions') || e.target.isContentEditable) return;
            switchPage(page.id);
        });
        
        // Rename
        const titleEl = el.querySelector('.page-item-title');
        const editBtn = el.querySelector('.edit-btn');
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            titleEl.contentEditable = true;
            titleEl.focus();
            document.execCommand('selectAll', false, null);
        });
        
        titleEl.addEventListener('blur', () => {
            titleEl.contentEditable = false;
            page.title = titleEl.innerText.trim() || 'Untitled Page';
            titleEl.innerText = page.title;
            saveState();
        });
        titleEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleEl.blur();
            }
        });
        
        // Delete
        const deleteBtn = el.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.pages.length === 1) {
                alert("You cannot delete your only page!");
                return;
            }
            if (confirm(`Delete page "${page.title}" and all its contents?`)) {
                state.pages = state.pages.filter(p => p.id !== page.id);
                state.nodes = state.nodes.filter(n => n.pageId !== page.id);
                // Edges cleaning will happen naturally or when needed
                if (uiState.activePageId === page.id) {
                    switchPage(state.pages[0].id);
                } else {
                    saveState();
                    renderPagesList();
                }
            }
        });
        
        // Drag and drop reordering
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', index);
            el.style.opacity = '0.5';
        });
        el.addEventListener('dragend', () => el.style.opacity = '1');
        el.addEventListener('dragover', (e) => e.preventDefault());
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const toIndex = index;
            if (fromIndex !== toIndex) {
                const [moved] = state.pages.splice(fromIndex, 1);
                state.pages.splice(toIndex, 0, moved);
                saveState();
                renderPagesList();
            }
        });
        
        pagesList.appendChild(el);
    });
}

function switchPage(pageId) {
    if (uiState.activePageId === pageId && uiState.currentCanvasId === null) return;
    uiState.activePageId = pageId;
    uiState.currentCanvasId = null;
    uiState.selectedNodeIds.clear();
    uiState.selectedEdgeId = null;
    uiState.canvasOffset = { x: 0, y: 0 };
    setZoom(1);
    
    applyPageSettings();
    saveState();
    renderPagesList();
    renderBreadcrumbs();
    renderAll();
    updateSidebarUI();
}

function applyPageSettings() {
    const page = state.pages.find(p => p.id === uiState.activePageId);
    if (page) {
        document.body.style.setProperty('--grid-size', page.settings.gridSize + 'px');
        document.body.style.setProperty('--subtasks-per-row', page.settings.subtasksPerRow);
    }
}

document.getElementById('btn-add-page').addEventListener('click', () => {
    const newPage = { 
        id: generateId(), 
        title: 'New Page',
        settings: { subtasksPerRow: 1, defaultAlignment: 'center', gridSize: 40, snapToGrid: false }
    };
    state.pages.push(newPage);
    switchPage(newPage.id);
    
    // Focus rename immediately
    setTimeout(() => {
        const items = pagesList.querySelectorAll('.page-item');
        const lastItemTitle = items[items.length - 1].querySelector('.page-item-title');
        lastItemTitle.contentEditable = true;
        lastItemTitle.focus();
        document.execCommand('selectAll', false, null);
    }, 50);
});

// Rendering
function renderAll() {
    nodesContainer.innerHTML = '';
    labelsContainer.innerHTML = '';
    edgesGroup.innerHTML = '';
    nodesContainer.style.transform = `translate(${uiState.canvasOffset.x}px, ${uiState.canvasOffset.y}px) scale(${uiState.zoom})`;
    labelsContainer.style.transform = `translate(${uiState.canvasOffset.x}px, ${uiState.canvasOffset.y}px) scale(${uiState.zoom})`;
    edgesGroup.setAttribute('transform', `translate(${uiState.canvasOffset.x}, ${uiState.canvasOffset.y}) scale(${uiState.zoom})`);
    drawingEdge.setAttribute('transform', `translate(${uiState.canvasOffset.x}, ${uiState.canvasOffset.y}) scale(${uiState.zoom})`);
    
    const visibleNodes = state.nodes.filter(n => n.parentId === uiState.currentCanvasId && n.pageId === uiState.activePageId);
    visibleNodes.forEach(renderNode);
    
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = state.edges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
    visibleEdges.forEach(renderEdge);
    
    renderMinimap(visibleNodes);
}

function renderNode(nodeData) {
    const el = document.createElement('div');
    el.className = `node node-type-${nodeData.type}`;
    if (nodeData.completed) el.classList.add('completed-node');
    el.id = `node-${nodeData.id}`;
    
    if (uiState.selectedNodeIds.has(nodeData.id)) {
        el.classList.add('selected');
    }
    if (nodeData.color) {
        el.classList.add(`color-theme-${nodeData.color}`);
    }

    el.style.transform = `translate(${nodeData.x}px, ${nodeData.y}px)`;
    if (nodeData.width) el.style.width = `${nodeData.width}px`;
    if (nodeData.height) el.style.height = `${nodeData.height}px`;

    let content = `
        <div class="node-header" style="justify-content: ${nodeData.textAlign === 'left' ? 'flex-start' : nodeData.textAlign === 'right' ? 'flex-end' : 'center'}">
            <span class="node-title" style="text-align: ${nodeData.textAlign || 'center'}; width: 100%; display: block;">${nodeData.title}</span>
        </div>
    `;

    if (nodeData.type === 'container') {
        content += `<div class="resize-handle" data-node="${nodeData.id}"></div>`;
        content += `
            <div class="port port-top" data-node="${nodeData.id}" data-port="top"></div>
            <div class="port port-right" data-node="${nodeData.id}" data-port="right"></div>
            <div class="port port-bottom" data-node="${nodeData.id}" data-port="bottom"></div>
            <div class="port port-left" data-node="${nodeData.id}" data-port="left"></div>
        `;
        el.innerHTML = content;
        
        el.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle')) {
                e.stopPropagation();
                uiState.isResizing = true;
                uiState.resizeNodeId = nodeData.id;
            } else if (!e.target.classList.contains('port')) {
                startNodeDrag(e, nodeData.id);
            }
        });
        
        el.addEventListener('click', (e) => {
            if (!uiState.hasDragged) {
                uiState.selectedEdgeId = null;
                if (e.ctrlKey || e.shiftKey) {
                    if (uiState.selectedNodeIds.has(nodeData.id)) uiState.selectedNodeIds.delete(nodeData.id);
                    else uiState.selectedNodeIds.add(nodeData.id);
                    updateSelectionVisuals();
                    updateSidebarUI();
                } else {
                    if (uiState.selectedNodeIds.size === 1 && uiState.selectedNodeIds.has(nodeData.id)) return;
                    uiState.selectedNodeIds.clear();
                    uiState.selectedNodeIds.add(nodeData.id);
                    updateSelectionVisuals();
                    updateSidebarUI();
                }
            }
        });
        el.addEventListener('contextmenu', (e) => showContextMenu(e, nodeData.id));
        
        const ports = el.querySelectorAll('.port');
        ports.forEach(port => {
            port.addEventListener('mousedown', (e) => startConnection(e, nodeData.id, port.dataset.port));
            port.addEventListener('mouseup', (e) => finishConnection(e, nodeData.id, port.dataset.port));
        });

        nodesContainer.appendChild(el);
        return;
    }

    const children = state.nodes.filter(n => n.parentId === nodeData.id);
    const taskChildren = children.filter(n => n.type === 'task');
    const infoChildren = children.filter(n => n.type === 'info');

    let subtasksHtml = '';
    if (nodeData.type === 'task') {
        subtasksHtml = taskChildren.map(st => 
            `<span class="sub-node-pill" style="${st.completed ? 'background:var(--color-accent-green); color:white;' : ''}">${st.title}</span>`
        ).join('');
        if (infoChildren.length > 0) {
            subtasksHtml += `<span class="sub-node-pill" style="background: var(--color-accent-blue); color: #fff;">+ ${infoChildren.length} Info</span>`;
        }
    } else if (nodeData.type === 'info') {
        if (children.length > 0) {
            subtasksHtml += `<span class="sub-node-pill" style="background: var(--color-accent-blue); color: #fff;">${children.length} Nested</span>`;
        }
    }

    content += `<div class="sub-nodes-container">${subtasksHtml}</div>`;
    
    content += `
        <div class="port port-top" data-node="${nodeData.id}" data-port="top"></div>
        <div class="port port-right" data-node="${nodeData.id}" data-port="right"></div>
        <div class="port port-bottom" data-node="${nodeData.id}" data-port="bottom"></div>
        <div class="port port-left" data-node="${nodeData.id}" data-port="left"></div>
    `;

    el.innerHTML = content;
    
    el.addEventListener('mousedown', (e) => {
        if (!e.target.classList.contains('port')) startNodeDrag(e, nodeData.id);
    });
    
    el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        enterCanvas(nodeData.id);
    });

    el.addEventListener('click', (e) => {
        if (!uiState.hasDragged && !e.target.classList.contains('port')) {
            uiState.selectedEdgeId = null;
            if (e.ctrlKey || e.shiftKey) {
                if (uiState.selectedNodeIds.has(nodeData.id)) uiState.selectedNodeIds.delete(nodeData.id);
                else uiState.selectedNodeIds.add(nodeData.id);
                updateSelectionVisuals();
                updateSidebarUI();
            } else {
                if (uiState.selectedNodeIds.size === 1 && uiState.selectedNodeIds.has(nodeData.id)) return;
                uiState.selectedNodeIds.clear();
                uiState.selectedNodeIds.add(nodeData.id);
                updateSelectionVisuals();
                updateSidebarUI();
            }
        }
    });
    
    el.addEventListener('contextmenu', (e) => showContextMenu(e, nodeData.id));

    const ports = el.querySelectorAll('.port');
    ports.forEach(port => {
        port.addEventListener('mousedown', (e) => startConnection(e, nodeData.id, port.dataset.port));
        port.addEventListener('mouseup', (e) => finishConnection(e, nodeData.id, port.dataset.port));
    });

    el.addEventListener('mouseup', (e) => {
        if (uiState.isConnecting) {
            finishConnection(e, nodeData.id, 'auto');
        }
    });

    nodesContainer.appendChild(el);
}

function getPortCenter(nodeId, port = 'auto') {
    const nodeData = state.nodes.find(n => n.id === nodeId);
    if (!nodeData) return {x:0, y:0, dir:{x:0, y:0}, isAuto: true};
    
    let width = nodeData.width || 180;
    let height = nodeData.height || 80;
    
    const el = document.getElementById(`node-${nodeId}`);
    if (el) {
        width = el.offsetWidth;
        height = el.offsetHeight;
    }
    
    if (port === 'auto') {
        return {
            x: nodeData.x + width / 2,
            y: nodeData.y + height / 2,
            dir: { x: 0, y: 0 },
            isAuto: true
        };
    }
    
    switch(port) {
        case 'top': return { x: nodeData.x + width / 2, y: nodeData.y - 4, dir: { x: 0, y: -1 } };
        case 'bottom': return { x: nodeData.x + width / 2, y: nodeData.y + height + 4, dir: { x: 0, y: 1 } };
        case 'left': return { x: nodeData.x - 4, y: nodeData.y + height / 2, dir: { x: -1, y: 0 } };
        case 'right': return { x: nodeData.x + width + 4, y: nodeData.y + height / 2, dir: { x: 1, y: 0 } };
        default: return { x: nodeData.x + width / 2, y: nodeData.y + height / 2, dir: { x: 1, y: 0 } };
    }
}

function renderEdge(edgeData) {
    const sourceNode = state.nodes.find(n => n.id === edgeData.source);
    const targetNode = state.nodes.find(n => n.id === edgeData.target);
    if (!sourceNode || !targetNode) return;
    
    const sp = edgeData.sourcePort || 'auto';
    const tp = edgeData.targetPort || 'auto';
    
    let sPort = getPortCenter(edgeData.source, sp);
    let tPort = getPortCenter(edgeData.target, tp);
    
    if (sPort.isAuto || tPort.isAuto) {
        const isLeftToRight = tPort.x >= sPort.x;
        if (sPort.isAuto) sPort = getPortCenter(edgeData.source, isLeftToRight ? 'right' : 'left');
        if (tPort.isAuto) tPort = getPortCenter(edgeData.target, isLeftToRight ? 'left' : 'right');
    }
    
    const path = createSVGPath(sPort, tPort);
    
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', path);
    pathEl.setAttribute('class', 'edge-path');
    if (uiState.selectedEdgeId === edgeData.id) {
        pathEl.classList.add('selected');
    }
    
    const lineStyleStr = edgeData.lineStyle === 'dashed' ? '5,5' : edgeData.lineStyle === 'dotted' ? '2,4' : 'none';
    const colorVar = edgeData.color ? `var(--color-accent-${edgeData.color})` : 'var(--color-accent-gold)';
    const colorName = edgeData.color || 'gold';
    
    pathEl.setAttribute('stroke-dasharray', lineStyleStr);
    pathEl.style.setProperty('--edge-color', colorVar);

    if (edgeData.arrowEnd !== false) {
        pathEl.setAttribute('marker-end', `url(#arrowhead-${colorName})`);
    } else {
        pathEl.removeAttribute('marker-end');
    }
    
    if (edgeData.arrowStart) {
        pathEl.setAttribute('marker-start', `url(#arrowstart-${colorName})`);
    } else {
        pathEl.removeAttribute('marker-start');
    }

    pathEl.id = `edge-${edgeData.id}`;
    
    pathEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (uiState.selectedEdgeId !== edgeData.id) {
            uiState.selectedNodeIds.clear();
            uiState.selectedEdgeId = edgeData.id;
            renderAll();
            updateSidebarUI();
        }
    });

    pathEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        uiState.selectedNodeIds.clear();
        uiState.selectedEdgeId = edgeData.id;
        renderAll();
        updateSidebarUI();
        const label = document.getElementById(`edge-label-${edgeData.id}`);
        if (label) {
            label.contentEditable = true;
            label.focus();
            document.execCommand('selectAll', false, null);
        }
    });

    pathEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uiState.selectedNodeIds.clear();
        uiState.selectedEdgeId = edgeData.id;
        renderAll();
        updateSidebarUI();
        
        document.getElementById('cm-add-task').style.display = 'none';
        document.getElementById('cm-add-info').style.display = 'none';
        document.getElementById('cm-delete').style.display = 'block';
        contextMenu.style.display = 'flex';
        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
    });

    edgesGroup.appendChild(pathEl);

    const dx = tPort.x - sPort.x;
    const dy = tPort.y - sPort.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const curve = Math.max(dist * 0.5, 80);
    const c1x = sPort.x + sPort.dir.x * curve;
    const c1y = sPort.y + sPort.dir.y * curve;
    const c2x = tPort.x + tPort.dir.x * curve;
    const c2y = tPort.y + tPort.dir.y * curve;
    
    const t = edgeData.labelPosition !== undefined ? edgeData.labelPosition : 0.5;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    const labelX = mt3 * sPort.x + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t3 * tPort.x;
    const labelY = mt3 * sPort.y + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t3 * tPort.y;

    const labelEl = document.createElement('div');
    labelEl.className = 'edge-label';
    labelEl.id = `edge-label-${edgeData.id}`;
    if (uiState.selectedEdgeId === edgeData.id) {
        labelEl.classList.add('selected');
    }
    labelEl.style.left = labelX + 'px';
    labelEl.style.top = labelY + 'px';
    labelEl.innerText = edgeData.text || '';
    
    if (!edgeData.text && uiState.selectedEdgeId !== edgeData.id) {
        labelEl.style.opacity = '0';
    } else {
        labelEl.style.opacity = '1';
    }

    labelEl.addEventListener('mousedown', (e) => {
        if (labelEl.contentEditable === "true") return;
        e.stopPropagation();
        uiState.isDraggingLabel = true;
        uiState.draggedLabelId = edgeData.id;
        if (uiState.selectedEdgeId !== edgeData.id) {
            uiState.selectedNodeIds.clear();
            uiState.selectedEdgeId = edgeData.id;
            updateSidebarUI();
            labelEl.classList.add('selected');
        }
    });

    labelEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (labelEl.contentEditable === "true") return;
        
        if (uiState.selectedEdgeId !== edgeData.id) {
            uiState.selectedNodeIds.clear();
            uiState.selectedEdgeId = edgeData.id;
            renderAll();
            updateSidebarUI();
        }
    });

    labelEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (labelEl.contentEditable === "true") return;
        
        uiState.selectedNodeIds.clear();
        uiState.selectedEdgeId = edgeData.id;
        labelEl.contentEditable = "true";
        labelEl.focus();
        document.execCommand('selectAll', false, null);
    });

    labelEl.addEventListener('blur', () => {
        labelEl.contentEditable = "false";
        edgeData.text = labelEl.innerText.trim();
        saveState();
        renderAll();
    });

    labelEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            labelEl.blur();
        }
    });

    labelEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uiState.selectedNodeIds.clear();
        uiState.selectedEdgeId = edgeData.id;
        renderAll();
        updateSidebarUI();
        
        document.getElementById('cm-add-task').style.display = 'none';
        document.getElementById('cm-add-info').style.display = 'none';
        document.getElementById('cm-delete').style.display = 'block';
        contextMenu.style.display = 'flex';
        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
    });

    labelsContainer.appendChild(labelEl);

    if (uiState.selectedEdgeId === edgeData.id) {
        const startHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        startHandle.setAttribute('cx', sPort.x);
        startHandle.setAttribute('cy', sPort.y);
        startHandle.setAttribute('r', '5');
        startHandle.setAttribute('class', 'edge-handle' + (uiState.draggedEdgeType === 'start' && uiState.draggedEdgeId === edgeData.id ? ' dragging' : ''));
        startHandle.addEventListener('mousedown', (e) => startEdgeDrag(e, edgeData.id, 'start'));
        
        const endHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        endHandle.setAttribute('cx', tPort.x);
        endHandle.setAttribute('cy', tPort.y);
        endHandle.setAttribute('r', '5');
        endHandle.setAttribute('class', 'edge-handle' + (uiState.draggedEdgeType === 'end' && uiState.draggedEdgeId === edgeData.id ? ' dragging' : ''));
        endHandle.addEventListener('mousedown', (e) => startEdgeDrag(e, edgeData.id, 'end'));
        
        edgesGroup.appendChild(startHandle);
        edgesGroup.appendChild(endHandle);
    }
}

function startEdgeDrag(e, edgeId, type) {
    e.stopPropagation();
    const edge = state.edges.find(e => e.id === edgeId);
    if (!edge) return;
    
    uiState.isConnecting = true;
    uiState.draggedEdgeId = edgeId;
    uiState.draggedEdgeType = type;
    
    if (type === 'end') {
        uiState.connectSourceId = edge.source;
        uiState.connectSourcePort = edge.sourcePort || 'auto';
    } else {
        uiState.connectSourceId = edge.target;
        uiState.connectSourcePort = edge.targetPort || 'auto';
    }
    
    // Visually hide the edge being dragged
    const pathEl = document.getElementById(`edge-${edgeId}`);
    if (pathEl) pathEl.style.display = 'none';
    const labelEl = document.getElementById(`edge-label-${edgeId}`);
    if (labelEl) labelEl.style.display = 'none';
}

function createSVGPath(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const curve = Math.max(dist * 0.5, 80);
    
    const c1x = p1.x + p1.dir.x * curve;
    const c1y = p1.y + p1.dir.y * curve;
    
    const c2x = p2.x + p2.dir.x * curve;
    const c2y = p2.y + p2.dir.y * curve;
    
    return `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
}

// Minimap
function renderMinimap(visibleNodes) {
    minimapContent.innerHTML = '';
    if (visibleNodes.length === 0) {
        minimapViewport.style.display = 'none';
        return;
    }
    minimapViewport.style.display = 'block';
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visibleNodes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + 180);
        maxY = Math.max(maxY, n.y + 80);
    });
    
    minX -= 400; minY -= 400; maxX += 400; maxY += 400;
    
    const mapWidth = maxX - minX;
    const mapHeight = maxY - minY;
    const scale = Math.min(200 / mapWidth, 150 / mapHeight);
    
    visibleNodes.forEach(n => {
        const el = document.createElement('div');
        el.className = `minimap-node ${n.type}`;
        el.style.left = (n.x - minX) * scale + 'px';
        el.style.top = (n.y - minY) * scale + 'px';
        el.style.width = 180 * scale + 'px';
        el.style.height = 80 * scale + 'px';
        minimapContent.appendChild(el);
    });
    
    const vpX = (-uiState.canvasOffset.x / uiState.zoom - minX) * scale;
    const vpY = (-uiState.canvasOffset.y / uiState.zoom - minY) * scale;
    const vpW = (window.innerWidth / uiState.zoom) * scale;
    const vpH = (window.innerHeight / uiState.zoom) * scale;
    
    minimapViewport.style.left = vpX + 'px';
    minimapViewport.style.top = vpY + 'px';
    minimapViewport.style.width = vpW + 'px';
    minimapViewport.style.height = vpH + 'px';
}

// Navigation
function enterCanvas(nodeId) {
    uiState.currentCanvasId = nodeId;
    uiState.selectedNodeIds.clear();
    uiState.selectedEdgeId = null;
    uiState.canvasOffset = { x: 0, y: 0 };
    setZoom(1);
    renderBreadcrumbs();
    renderAll();
    updateSidebarUI();
}

function renderBreadcrumbs() {
    bcHome.classList.toggle('active', uiState.currentCanvasId === null);
    let path = [];
    let currentId = uiState.currentCanvasId;
    while(currentId) {
        const node = state.nodes.find(n => n.id === currentId);
        if(node) {
            path.unshift({id: node.id, title: node.title});
            currentId = node.parentId;
        } else {
            break;
        }
    }

    breadcrumbTrail.innerHTML = '';
    path.forEach((step, idx) => {
        const sep = document.createElement('span');
        sep.className = 'bc-separator';
        sep.innerText = '>';
        breadcrumbTrail.appendChild(sep);

        const btn = document.createElement('button');
        btn.className = 'bc-item';
        if (idx === path.length - 1) btn.classList.add('active');
        btn.innerText = step.title;
        btn.onclick = () => enterCanvas(step.id);
        breadcrumbTrail.appendChild(btn);
    });
}

function setZoom(newZoom) {
    uiState.zoom = Math.max(0.1, Math.min(newZoom, 3));
    document.getElementById('zoom-reset').innerText = Math.round(uiState.zoom * 100) + '%';
    renderAll();
}

// Interactions
function setupEventListeners() {
    bcHome.onclick = () => enterCanvas(null);

    themeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'light' ? 'dark' : 'light';
        applyTheme(state.theme);
        saveState();
        if (typeof scModeSelect !== 'undefined') {
            scModeSelect.value = state.theme;
            renderColorInputs();
        }
    });

    document.getElementById('toggle-sidebar-left').addEventListener('click', () => {
        sidebarLeft.classList.toggle('collapsed');
        if (sidebarLeft.classList.contains('collapsed')) {
            document.getElementById('zoom-controls').style.left = '80px';
        } else {
            document.getElementById('zoom-controls').style.left = '300px';
        }
    });

    document.getElementById('toggle-sidebar-right').addEventListener('click', () => {
        detailsSidebar.classList.toggle('collapsed');
        if (detailsSidebar.classList.contains('collapsed')) {
            document.getElementById('minimap-container').style.right = '20px';
        } else {
            document.getElementById('minimap-container').style.right = '380px';
        }
    });

    document.getElementById('zoom-in').onclick = () => setZoom(uiState.zoom + 0.1);
    document.getElementById('zoom-out').onclick = () => setZoom(uiState.zoom - 0.1);
    document.getElementById('zoom-reset').onclick = () => { uiState.canvasOffset = {x:0,y:0}; setZoom(1); };

    document.getElementById('minimap-container').addEventListener('click', () => {
        const visibleNodes = state.nodes.filter(n => n.parentId === uiState.currentCanvasId && n.pageId === uiState.activePageId);
        if (visibleNodes.length === 0) {
            uiState.canvasOffset = {x:0, y:0};
            setZoom(1);
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visibleNodes.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + 180);
            maxY = Math.max(maxY, n.y + 80);
        });

        const padding = 100;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;

        const scaleX = window.innerWidth / width;
        const scaleY = window.innerHeight / height;
        const newZoom = Math.max(0.1, Math.min(scaleX, scaleY, 1)); 
        
        uiState.canvasOffset = {
            x: window.innerWidth / 2 - ((minX + maxX) / 2) * newZoom,
            y: window.innerHeight / 2 - ((minY + maxY) / 2) * newZoom
        };
        
        setZoom(newZoom);
    });

    workspace.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            setZoom(uiState.zoom - e.deltaY * 0.001);
        }
    }, { passive: false });

    document.getElementById('export-page').addEventListener('click', () => {
        const activePage = state.pages.find(p => p.id === uiState.activePageId);
        if (!activePage) return;

        let content = `# ${activePage.title}\n\n`;
        const rootNodes = state.nodes.filter(n => n.parentId === null && n.pageId === uiState.activePageId);

        function appendNode(node, depth) {
            const indent = '  '.repeat(depth);
            const typeStr = node.type === 'task' ? (node.completed ? '[x] ' : '[ ] ') : '(i) ';
            content += `${indent}- ${typeStr}${node.title}\n`;
            
            if (node.description && node.description.trim() !== '') {
                const descLines = node.description.split('\n');
                descLines.forEach(line => {
                    content += `${indent}    ${line}\n`;
                });
            }
            
            const children = state.nodes.filter(n => n.parentId === node.id);
            children.forEach(child => appendNode(child, depth + 1));
        }

        rootNodes.forEach(n => appendNode(n, 0));

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activePage.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    document.getElementById('clear-data').addEventListener('click', () => {
        const activePage = state.pages.find(p => p.id === uiState.activePageId);
        if (!activePage) return;
        
        if(confirm(`Clear all bubbles on the page "${activePage.title}"?`)) {
            state.nodes = state.nodes.filter(n => n.pageId !== uiState.activePageId);
            
            const remainingNodeIds = new Set(state.nodes.map(n => n.id));
            state.edges = state.edges.filter(e => remainingNodeIds.has(e.source) && remainingNodeIds.has(e.target));
            
            uiState.currentCanvasId = null;
            uiState.selectedNodeIds.clear();
            uiState.selectedEdgeId = null;
            uiState.canvasOffset = {x:0, y:0};
            setZoom(1);
            
            saveState();
            renderBreadcrumbs();
            renderAll();
            updateSidebarUI();
        }
    });

    // Global Mouse Events
    workspace.addEventListener('mousedown', (e) => {
        if (e.target.id === 'workspace' || e.target.id === 'edges-canvas' || e.target.id === 'nodes-container') {
            closeContextMenu();
            if (e.shiftKey) {
                uiState.isSelecting = true;
                uiState.selectStart = { x: e.clientX, y: e.clientY };
                selectionBox.style.display = 'block';
                selectionBox.style.left = e.clientX + 'px';
                selectionBox.style.top = e.clientY + 'px';
                selectionBox.style.width = '0px';
                selectionBox.style.height = '0px';
                
                if (!e.ctrlKey) {
                    uiState.selectedNodeIds.clear();
                    uiState.selectedEdgeId = null;
                    renderAll();
                    updateSidebarUI();
                }
            } else {
                uiState.isPanning = true;
                uiState.panStart = { x: e.clientX - uiState.canvasOffset.x, y: e.clientY - uiState.canvasOffset.y };
                uiState.selectedNodeIds.clear();
                uiState.selectedEdgeId = null;
                renderAll();
                updateSidebarUI();
            }
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (uiState.isResizing) {
            const dx = e.movementX / uiState.zoom;
            const dy = e.movementY / uiState.zoom;
            const node = state.nodes.find(n => n.id === uiState.resizeNodeId);
            if (node) {
                node.width = Math.max(100, (node.width || 180) + dx);
                node.height = Math.max(80, (node.height || 80) + dy);
                renderAll();
            }
        } else if (uiState.isDraggingNode) {
            uiState.hasDragged = true;
            const dx = e.movementX / uiState.zoom;
            const dy = e.movementY / uiState.zoom;
            
            if (uiState.selectedNodeIds.has(uiState.dragNodeId)) {
                uiState.selectedNodeIds.forEach(id => {
                    const node = state.nodes.find(n => n.id === id);
                    if (node) { node.x += dx; node.y += dy; }
                });
            } else {
                const node = state.nodes.find(n => n.id === uiState.dragNodeId);
                if (node) { node.x += dx; node.y += dy; }
            }
            uiState.dragExtraIds.forEach(id => {
                if (!uiState.selectedNodeIds.has(id)) {
                    const node = state.nodes.find(n => n.id === id);
                    if (node) { node.x += dx; node.y += dy; }
                }
            });
            renderAll();
        } else if (uiState.isPanning) {
            uiState.canvasOffset.x = e.clientX - uiState.panStart.x;
            uiState.canvasOffset.y = e.clientY - uiState.panStart.y;
            renderAll();
        } else if (uiState.isSelecting) {
            const x = Math.min(e.clientX, uiState.selectStart.x);
            const y = Math.min(e.clientY, uiState.selectStart.y);
            const w = Math.abs(e.clientX - uiState.selectStart.x);
            const h = Math.abs(e.clientY - uiState.selectStart.y);
            
            selectionBox.style.left = x + 'px';
            selectionBox.style.top = y + 'px';
            selectionBox.style.width = w + 'px';
            selectionBox.style.height = h + 'px';

            const rectX = (x - uiState.canvasOffset.x) / uiState.zoom;
            const rectY = (y - uiState.canvasOffset.y) / uiState.zoom;
            const rectW = w / uiState.zoom;
            const rectH = h / uiState.zoom;

            const visibleNodes = state.nodes.filter(n => n.parentId === uiState.currentCanvasId && n.pageId === uiState.activePageId);
            visibleNodes.forEach(node => {
                const intersects = !(node.x + 180 < rectX || 
                                     node.x > rectX + rectW || 
                                     node.y + 80 < rectY || 
                                     node.y > rectY + rectH);
                if (intersects) uiState.selectedNodeIds.add(node.id);
            });
            renderAll();
        } else if (uiState.isConnecting) {
            let p1 = getPortCenter(uiState.connectSourceId, uiState.connectSourcePort || 'auto');
            const targetPoint = {
                x: (e.clientX - uiState.canvasOffset.x) / uiState.zoom,
                y: (e.clientY - uiState.canvasOffset.y) / uiState.zoom,
                dir: { x: 0, y: 0 },
                isAuto: true
            };
            
            if (p1.isAuto) {
                const isLeftToRight = targetPoint.x >= p1.x;
                p1 = getPortCenter(uiState.connectSourceId, isLeftToRight ? 'right' : 'left');
                targetPoint.dir = { x: isLeftToRight ? -1 : 1, y: 0 };
            } else {
                targetPoint.dir = { x: -p1.dir.x, y: -p1.dir.y };
            }
            
            if (uiState.draggedEdgeType === 'start') {
                drawingEdge.setAttribute('d', createSVGPath(targetPoint, p1));
            } else {
                drawingEdge.setAttribute('d', createSVGPath(p1, targetPoint));
            }
            drawingEdge.style.display = 'block';
        } else if (uiState.isDraggingLabel) {
            const edge = state.edges.find(ed => ed.id === uiState.draggedLabelId);
            if (edge) {
                const sp = edge.sourcePort || 'auto';
                const tp = edge.targetPort || 'auto';
                let sPort = getPortCenter(edge.source, sp);
                let tPort = getPortCenter(edge.target, tp);
                if (sPort.isAuto || tPort.isAuto) {
                    const isLeftToRight = tPort.x >= sPort.x;
                    if (sPort.isAuto) sPort = getPortCenter(edge.source, isLeftToRight ? 'right' : 'left');
                    if (tPort.isAuto) tPort = getPortCenter(edge.target, isLeftToRight ? 'left' : 'right');
                }
                const dx = tPort.x - sPort.x;
                const dy = tPort.y - sPort.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const curve = Math.max(dist * 0.5, 80);
                const c1x = sPort.x + sPort.dir.x * curve;
                const c1y = sPort.y + sPort.dir.y * curve;
                const c2x = tPort.x + tPort.dir.x * curve;
                const c2y = tPort.y + tPort.dir.y * curve;
                
                const mx = (e.clientX - uiState.canvasOffset.x) / uiState.zoom;
                const my = (e.clientY - uiState.canvasOffset.y) / uiState.zoom;
                
                let bestT = 0.5;
                let minDist = Infinity;
                
                for(let i = 0; i <= 20; i++) {
                    const t = i / 20;
                    const mt = 1 - t;
                    const mt2 = mt * mt;
                    const mt3 = mt2 * mt;
                    const t2 = t * t;
                    const t3 = t2 * t;
                    const px = mt3 * sPort.x + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t3 * tPort.x;
                    const py = mt3 * sPort.y + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t3 * tPort.y;
                    
                    const d = (px - mx)**2 + (py - my)**2;
                    if (d < minDist) {
                        minDist = d;
                        bestT = t;
                    }
                }
                
                edge.labelPosition = bestT;
                renderAll();
            }
        }
    });

    window.addEventListener('mouseup', () => {
        if (uiState.isResizing) {
            uiState.isResizing = false;
            uiState.resizeNodeId = null;
            saveState();
        }
        if (uiState.isDraggingNode) {
            if (uiState.hasDragged) {
                const page = state.pages.find(p => p.id === uiState.activePageId);
                if (page && page.settings.snapToGrid) {
                    const gridSize = page.settings.gridSize;
                    const nodesToSnap = uiState.selectedNodeIds.has(uiState.dragNodeId) 
                        ? Array.from(uiState.selectedNodeIds) 
                        : [uiState.dragNodeId];
                    nodesToSnap.push(...Array.from(uiState.dragExtraIds));
                    
                    nodesToSnap.forEach(id => {
                        const node = state.nodes.find(n => n.id === id);
                        if (node) {
                            node.x = Math.round(node.x / gridSize) * gridSize;
                            node.y = Math.round(node.y / gridSize) * gridSize;
                        }
                    });
                    renderAll();
                }
                saveState();
            }
        }
        if (uiState.isSelecting) {
            selectionBox.style.display = 'none';
            updateSidebarUI();
        }
        if (uiState.isDraggingLabel) {
            uiState.isDraggingLabel = false;
            uiState.draggedLabelId = null;
            saveState();
        }
        uiState.isDraggingNode = false;
        uiState.dragNodeId = null;
        uiState.dragExtraIds.clear();
        setTimeout(() => { uiState.hasDragged = false; }, 0);
        uiState.isPanning = false;
        uiState.isSelecting = false;
        
        if (uiState.isConnecting) {
            if (uiState.draggedEdgeId) {
                state.edges = state.edges.filter(ed => ed.id !== uiState.draggedEdgeId);
                if (uiState.selectedEdgeId === uiState.draggedEdgeId) {
                    uiState.selectedEdgeId = null;
                    updateSidebarUI();
                }
                saveState();
                renderAll();
            }
            uiState.isConnecting = false;
            uiState.connectSourceId = null;
            uiState.connectSourcePort = null;
            uiState.draggedEdgeId = null;
            uiState.draggedEdgeType = null;
            drawingEdge.style.display = 'none';
        }
    });

    workspace.addEventListener('contextmenu', (e) => {
        if (e.target.id === 'workspace' || e.target.id === 'edges-canvas' || e.target.id === 'nodes-container') {
            e.preventDefault();
            uiState.selectedNodeIds.clear();
            uiState.selectedEdgeId = null;
            renderAll();
            updateSidebarUI();
            
            document.getElementById('cm-add-task').style.display = 'block';
            document.getElementById('cm-add-info').style.display = 'block';
            document.getElementById('cm-add-container').style.display = 'block';
            document.getElementById('cm-group').style.display = 'none';
            document.getElementById('cm-ungroup').style.display = 'none';
            document.getElementById('cm-copy').style.display = uiState.selectedNodeIds.size > 0 ? 'block' : 'none';
            document.getElementById('cm-paste').style.display = clipboardData.nodes.length > 0 ? 'block' : 'none';
            document.getElementById('cm-delete').style.display = 'none';
            
            const rect = workspace.getBoundingClientRect();
            canvasContextMenuLocation = {
                x: (e.clientX - rect.left - uiState.canvasOffset.x) / uiState.zoom - 90,
                y: (e.clientY - rect.top - uiState.canvasOffset.y) / uiState.zoom - 40
            };
            
            contextMenu.style.display = 'flex';
            contextMenu.style.left = e.clientX + 'px';
            contextMenu.style.top = e.clientY + 'px';
        }
    });

    document.getElementById('ds-title').addEventListener('input', updateActiveNodeFromUI);
    document.getElementById('ds-description').addEventListener('input', updateActiveNodeFromUI);
    
    document.querySelectorAll('.align-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let activeNodeId = uiState.selectedNodeIds.size === 1 ? Array.from(uiState.selectedNodeIds)[0] : uiState.currentCanvasId;
            if (!activeNodeId) return;
            const node = state.nodes.find(n => n.id === activeNodeId);
            if (node) {
                node.textAlign = btn.dataset.align;
                saveState();
                renderAll();
                updateSidebarUI();
            }
        });
    });

    document.getElementById('ds-completed-checkbox').addEventListener('change', (e) => {
        let activeNodeId = uiState.selectedNodeIds.size === 1 ? Array.from(uiState.selectedNodeIds)[0] : uiState.currentCanvasId;
        if (activeNodeId) {
            window.toggleTaskComplete(activeNodeId, e.target.checked);
        }
    });

    // Edge Settings Listeners
    document.getElementById('es-line-style').addEventListener('change', (e) => {
        if (uiState.selectedEdgeId) {
            const edge = state.edges.find(ed => ed.id === uiState.selectedEdgeId);
            if (edge) { edge.lineStyle = e.target.value; saveState(); renderAll(); }
        }
    });
    document.getElementById('es-arrow-start').addEventListener('change', (e) => {
        if (uiState.selectedEdgeId) {
            const edge = state.edges.find(ed => ed.id === uiState.selectedEdgeId);
            if (edge) { edge.arrowStart = e.target.checked; saveState(); renderAll(); }
        }
    });
    document.getElementById('es-arrow-end').addEventListener('change', (e) => {
        if (uiState.selectedEdgeId) {
            const edge = state.edges.find(ed => ed.id === uiState.selectedEdgeId);
            if (edge) { edge.arrowEnd = e.target.checked; saveState(); renderAll(); }
        }
    });
    
    document.querySelectorAll('#ds-edge-color-palette .color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (uiState.selectedEdgeId) {
                const edge = state.edges.find(ed => ed.id === uiState.selectedEdgeId);
                if (edge) { 
                    edge.color = e.target.dataset.color; 
                    saveState(); renderAll(); updateSidebarUI();
                }
            }
        });
    });

    document.querySelectorAll('#ds-node-color-palette .color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let activeNodeId = uiState.selectedNodeIds.size === 1 ? Array.from(uiState.selectedNodeIds)[0] : uiState.currentCanvasId;
            if (activeNodeId) {
                const node = state.nodes.find(n => n.id === activeNodeId);
                if (node) {
                    node.color = e.target.dataset.color;
                    saveState(); renderAll(); updateSidebarUI();
                }
            }
        });
    });

    // Page Settings Listeners
    document.getElementById('ps-subtasks-row').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) {
            page.settings.subtasksPerRow = parseInt(e.target.value) || 1;
            saveState();
            applyPageSettings();
        }
    });

    document.getElementById('ps-default-align').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) {
            page.settings.defaultAlignment = e.target.value;
            saveState();
        }
    });

    document.getElementById('ps-grid-size').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) {
            page.settings.gridSize = parseInt(e.target.value) || 40;
            saveState();
            applyPageSettings();
        }
    });

    document.getElementById('ps-snap-toggle').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) {
            page.settings.snapToGrid = e.target.checked;
            saveState();
        }
    });

    document.getElementById('ds-add-nested-task').addEventListener('click', () => addNestedNodeToUI('task'));
    document.getElementById('ds-add-nested-info').addEventListener('click', () => addNestedNodeToUI('info'));

    document.getElementById('cm-delete').addEventListener('click', () => {
        if (uiState.selectedNodeIds.size > 0) uiState.selectedNodeIds.forEach(deleteNode);
        if (uiState.selectedEdgeId) {
            state.edges = state.edges.filter(e => e.id !== uiState.selectedEdgeId);
            uiState.selectedEdgeId = null;
            saveState();
        }
        closeContextMenu();
        renderAll();
        updateSidebarUI();
    });

    document.getElementById('cm-group').addEventListener('click', () => {
        if (uiState.selectedNodeIds.size > 1) groupSelectedNodes();
        closeContextMenu();
    });

    document.getElementById('cm-add-task').addEventListener('click', () => addNodeAtLocation('task'));
    document.getElementById('cm-add-info').addEventListener('click', () => addNodeAtLocation('info'));
    document.getElementById('cm-add-container').addEventListener('click', () => addNodeAtLocation('container'));
    document.getElementById('cm-ungroup').addEventListener('click', () => { ungroupBubble(); closeContextMenu(); });
    document.getElementById('cm-copy').addEventListener('click', () => { copySelection(); closeContextMenu(); });
    document.getElementById('cm-paste').addEventListener('click', () => { pasteSelection(); closeContextMenu(); });

    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                redo();
            } else {
                undo();
            }
            return;
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            copySelection();
            closeContextMenu();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            pasteSelection();
            closeContextMenu();
        } else if (e.key === 'Delete') {
            let changed = false;
            if (uiState.selectedNodeIds.size > 0) {
                uiState.selectedNodeIds.forEach(deleteNode);
                changed = true;
            }
            if (uiState.selectedEdgeId) {
                state.edges = state.edges.filter(ed => ed.id !== uiState.selectedEdgeId);
                uiState.selectedEdgeId = null;
                changed = true;
            }
            if (changed) {
                saveState();
                renderAll();
                updateSidebarUI();
            }
        }
    });
}

function addNodeAtLocation(type) {
    const page = state.pages.find(p => p.id === uiState.activePageId);
    const newNode = {
        id: generateId(),
        type: type,
        x: canvasContextMenuLocation.x,
        y: canvasContextMenuLocation.y,
        title: type === 'task' ? 'New Task Bubble' : type === 'info' ? 'New Info Bubble' : 'Container',
        description: '',
        completed: false,
        textAlign: page ? page.settings.defaultAlignment : 'center',
        parentId: uiState.currentCanvasId,
        pageId: uiState.activePageId
    };
    if (type === 'container') {
        newNode.width = 400;
        newNode.height = 300;
    }
    if (page && page.settings.snapToGrid) {
        newNode.x = Math.round(newNode.x / page.settings.gridSize) * page.settings.gridSize;
        newNode.y = Math.round(newNode.y / page.settings.gridSize) * page.settings.gridSize;
    }
    state.nodes.push(newNode);
    uiState.selectedNodeIds.clear();
    uiState.selectedNodeIds.add(newNode.id);
    saveState();
    renderAll();
    updateSidebarUI();
    closeContextMenu();
}

function startNodeDrag(e, id) {
    e.stopPropagation();
    uiState.isDraggingNode = true;
    uiState.hasDragged = false;
    uiState.dragNodeId = id;
    uiState.dragExtraIds.clear();

    const node = state.nodes.find(n => n.id === id);
    if (node && node.type === 'container') {
        const cw = node.width || 180;
        const ch = node.height || 80;
        const visibleNodes = state.nodes.filter(n => n.parentId === uiState.currentCanvasId && n.pageId === uiState.activePageId && n.id !== id);
        
        visibleNodes.forEach(n => {
            const nw = n.width || 180;
            const nh = n.height || 80;
            const centerX = n.x + nw / 2;
            const centerY = n.y + nh / 2;
            
            if (centerX >= node.x && centerX <= node.x + cw &&
                centerY >= node.y && centerY <= node.y + ch) {
                uiState.dragExtraIds.add(n.id);
            }
        });
    }

    if (!uiState.selectedNodeIds.has(id) && !e.ctrlKey && !e.shiftKey) {
        uiState.selectedNodeIds.clear();
        uiState.selectedNodeIds.add(id);
        updateSelectionVisuals();
        updateSidebarUI();
    }
}

function updateSelectionVisuals() {
    document.querySelectorAll('.node').forEach(n => {
        const id = n.id.replace('node-', '');
        if (uiState.selectedNodeIds.has(id)) {
            n.classList.add('selected');
        } else {
            n.classList.remove('selected');
        }
    });
}

function startConnection(e, id, port = 'auto') {
    e.stopPropagation();
    uiState.isConnecting = true;
    uiState.connectSourceId = id;
    uiState.connectSourcePort = port;
    uiState.draggedEdgeId = null;
    uiState.draggedEdgeType = null;
}

function finishConnection(e, id, port = 'auto') {
    e.stopPropagation();
    let shouldRender = false;
    
    if (uiState.isConnecting && uiState.connectSourceId !== id) {
        if (uiState.draggedEdgeId) {
            const edge = state.edges.find(ed => ed.id === uiState.draggedEdgeId);
            if (edge) {
                if (uiState.draggedEdgeType === 'start') {
                    edge.source = id;
                    edge.sourcePort = port;
                } else {
                    edge.target = id;
                    edge.targetPort = port;
                }
                saveState();
                shouldRender = true;
            }
        } else {
            const exists = state.edges.some(ed => 
                (ed.source === uiState.connectSourceId && ed.target === id) ||
                (ed.source === id && ed.target === uiState.connectSourceId)
            );
            if (!exists) {
                state.edges.push({ 
                    id: generateId(), 
                    source: uiState.connectSourceId, 
                    target: id, 
                    sourcePort: uiState.connectSourcePort || 'auto',
                    targetPort: port || 'auto',
                    color: 'gold', 
                    lineStyle: 'solid', 
                    arrowStart: false, 
                    arrowEnd: true 
                });
                saveState();
                shouldRender = true;
            }
        }
    }
    
    const wasDraggingEdge = !!uiState.draggedEdgeId;
    
    uiState.isConnecting = false;
    uiState.connectSourceId = null;
    uiState.connectSourcePort = null;
    uiState.draggedEdgeId = null;
    uiState.draggedEdgeType = null;
    drawingEdge.style.display = 'none';
    
    if (shouldRender || wasDraggingEdge) {
        renderAll();
    }
}

function toggleSelection(id) {
    // Obsolete function since we inline it
    if (uiState.selectedNodeIds.has(id)) uiState.selectedNodeIds.delete(id);
    else uiState.selectedNodeIds.add(id);
    updateSelectionVisuals();
    updateSidebarUI();
}

function deleteNode(id) {
    function getAllDescendantIds(parentId) {
        let ids = [];
        const children = state.nodes.filter(n => n.parentId === parentId);
        children.forEach(c => {
            ids.push(c.id);
            ids = ids.concat(getAllDescendantIds(c.id));
        });
        return ids;
    }
    const toDelete = [id, ...getAllDescendantIds(id)];
    state.nodes = state.nodes.filter(n => !toDelete.includes(n.id));
    state.edges = state.edges.filter(e => !toDelete.includes(e.source) && !toDelete.includes(e.target));
    uiState.selectedNodeIds.delete(id);
    saveState();
}

function groupSelectedNodes() {
    let minX = Infinity, minY = Infinity;
    uiState.selectedNodeIds.forEach(id => {
        const node = state.nodes.find(n => n.id === id);
        if (node) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
        }
    });

    const page = state.pages.find(p => p.id === uiState.activePageId);
    const groupNode = {
        id: generateId(),
        type: 'task',
        title: 'New Grouped Task',
        description: '',
        completed: false,
        textAlign: page ? page.settings.defaultAlignment : 'center',
        x: minX,
        y: minY,
        parentId: uiState.currentCanvasId,
        pageId: uiState.activePageId
    };
    if (page && page.settings.snapToGrid) {
        groupNode.x = Math.round(groupNode.x / page.settings.gridSize) * page.settings.gridSize;
        groupNode.y = Math.round(groupNode.y / page.settings.gridSize) * page.settings.gridSize;
    }
    state.nodes.push(groupNode);
    
    uiState.selectedNodeIds.forEach(id => {
        const node = state.nodes.find(n => n.id === id);
        if (node) {
            node.parentId = groupNode.id;
            node.x = node.x - minX + 100;
            node.y = node.y - minY + 100;
        }
    });
    uiState.selectedNodeIds.clear();
    saveState();
    renderAll();
    updateSidebarUI();
}

function showContextMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    uiState.selectedEdgeId = null;
    if (!uiState.selectedNodeIds.has(id)) {
        uiState.selectedNodeIds.clear();
        uiState.selectedNodeIds.add(id);
        renderAll();
        updateSidebarUI();
    }
    
    document.getElementById('cm-add-task').style.display = 'none';
    document.getElementById('cm-add-info').style.display = 'none';
    document.getElementById('cm-add-container').style.display = 'none';
    document.getElementById('cm-delete').style.display = 'block';
    
    contextMenu.style.display = 'flex';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    const groupBtn = document.getElementById('cm-group');
    groupBtn.style.display = uiState.selectedNodeIds.size > 1 ? 'block' : 'none';

    const ungroupBtn = document.getElementById('cm-ungroup');
    if (uiState.selectedNodeIds.size === 1) {
        const children = state.nodes.filter(n => n.parentId === id);
        ungroupBtn.style.display = children.length > 0 ? 'block' : 'none';
    } else {
        ungroupBtn.style.display = 'none';
    }

    document.getElementById('cm-copy').style.display = 'block';
    document.getElementById('cm-paste').style.display = clipboardData.nodes.length > 0 ? 'block' : 'none';
}

function closeContextMenu() {
    contextMenu.style.display = 'none';
}

function ungroupBubble() {
    if (uiState.selectedNodeIds.size !== 1) return;
    const parentId = Array.from(uiState.selectedNodeIds)[0];
    const parentNode = state.nodes.find(n => n.id === parentId);
    if (!parentNode) return;

    const children = state.nodes.filter(n => n.parentId === parentId);
    children.forEach(child => {
        child.parentId = parentNode.parentId;
        child.x += parentNode.x - 100;
        child.y += parentNode.y - 100;
    });

    state.nodes = state.nodes.filter(n => n.id !== parentId);
    state.edges = state.edges.filter(e => e.source !== parentId && e.target !== parentId);
    uiState.selectedNodeIds.clear();
    saveState();
    renderAll();
    updateSidebarUI();
}

function copySelection() {
    if (uiState.selectedNodeIds.size === 0) return;
    
    clipboardData.nodes = [];
    clipboardData.edges = [];
    
    function getAllDescendants(parentId) {
        let descendants = state.nodes.filter(n => n.parentId === parentId);
        let result = [...descendants];
        descendants.forEach(d => {
            result = result.concat(getAllDescendants(d.id));
        });
        return result;
    }

    const selectedNodes = Array.from(uiState.selectedNodeIds).map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
    let allCopiedNodes = [...selectedNodes];
    selectedNodes.forEach(node => {
        allCopiedNodes = allCopiedNodes.concat(getAllDescendants(node.id));
    });

    allCopiedNodes = Array.from(new Set(allCopiedNodes));
    
    allCopiedNodes.forEach(node => {
        clipboardData.nodes.push(JSON.parse(JSON.stringify(node)));
    });

    const copiedNodeIds = new Set(allCopiedNodes.map(n => n.id));
    state.edges.forEach(edge => {
        if (copiedNodeIds.has(edge.source) && copiedNodeIds.has(edge.target)) {
            clipboardData.edges.push(JSON.parse(JSON.stringify(edge)));
        }
    });
}

function pasteSelection() {
    if (clipboardData.nodes.length === 0) return;
    
    const idMap = {};
    const newNodes = [];
    const newEdges = [];

    clipboardData.nodes.forEach(node => {
        const newId = generateId();
        idMap[node.id] = newId;
    });

    const copiedIds = new Set(clipboardData.nodes.map(n => n.id));

    clipboardData.nodes.forEach(node => {
        const newNode = JSON.parse(JSON.stringify(node));
        newNode.id = idMap[node.id];
        newNode.pageId = uiState.activePageId;
        
        if (node.parentId && copiedIds.has(node.parentId)) {
            newNode.parentId = idMap[node.parentId];
        } else {
            newNode.parentId = uiState.currentCanvasId;
            newNode.x += 40;
            newNode.y += 40;
        }
        
        newNodes.push(newNode);
        state.nodes.push(newNode);
    });

    clipboardData.edges.forEach(edge => {
        const newEdge = JSON.parse(JSON.stringify(edge));
        newEdge.id = generateId();
        newEdge.source = idMap[edge.source];
        newEdge.target = idMap[edge.target];
        newEdges.push(newEdge);
        state.edges.push(newEdge);
    });

    uiState.selectedNodeIds.clear();
    newNodes.filter(n => n.parentId === uiState.currentCanvasId).forEach(n => uiState.selectedNodeIds.add(n.id));
    
    saveState();
    renderAll();
    updateSidebarUI();
}

// Sidebar Logic
function updateSidebarUI() {
    let activeNodeId = null;
    if (uiState.selectedNodeIds.size === 1) activeNodeId = Array.from(uiState.selectedNodeIds)[0];
    else if (uiState.selectedNodeIds.size === 0 && uiState.currentCanvasId) activeNodeId = uiState.currentCanvasId;

    if (uiState.selectedEdgeId) {
        document.getElementById('ds-node-details').style.display = 'none';
        document.getElementById('ds-page-settings').style.display = 'none';
        document.getElementById('ds-edge-settings').style.display = 'block';
        document.getElementById('ds-status').innerText = "Line Selected";
        
        const edge = state.edges.find(e => e.id === uiState.selectedEdgeId);
        if (edge) {
            document.getElementById('es-line-style').value = edge.lineStyle || 'solid';
            document.getElementById('es-arrow-start').checked = !!edge.arrowStart;
            document.getElementById('es-arrow-end').checked = edge.arrowEnd !== false;
            
            const color = edge.color || 'gold';
            document.querySelectorAll('#ds-edge-color-palette .color-btn').forEach(btn => {
                btn.classList.toggle('selected', btn.dataset.color === color);
            });
        }
        return;
    }

    document.getElementById('ds-edge-settings').style.display = 'none';

    if (activeNodeId) {
        document.getElementById('ds-node-details').style.display = 'block';
        document.getElementById('ds-page-settings').style.display = 'none';
        
        const node = state.nodes.find(n => n.id === activeNodeId);
        if (node) {
            const checkbox = document.getElementById('ds-completed-checkbox');
            if (node.type === 'task') {
                checkbox.style.display = 'block';
                checkbox.checked = node.completed;
            } else {
                checkbox.style.display = 'none';
            }
            
            if (node.type === 'container') {
                document.getElementById('ds-nested-section').style.display = 'none';
                document.getElementById('ds-alignment-controls').style.display = 'none';
            } else {
                document.getElementById('ds-nested-section').style.display = 'block';
                document.getElementById('ds-alignment-controls').style.display = 'flex';
                document.querySelectorAll('.align-btn').forEach(btn => {
                    btn.style.background = btn.dataset.align === (node.textAlign || 'center') ? 'rgba(212, 175, 55, 0.3)' : 'none';
                });
            }
            
            document.getElementById('ds-title').innerText = node.title;
            document.getElementById('ds-description').value = node.description || '';
            document.getElementById('ds-description').disabled = false;
            document.getElementById('ds-title').setAttribute('contenteditable', 'true');
            
            document.querySelectorAll('#ds-node-color-palette .color-btn').forEach(btn => {
                btn.classList.toggle('selected', btn.dataset.color === node.color);
            });
        }
    } else {
        document.getElementById('ds-node-details').style.display = 'none';
        document.getElementById('ds-page-settings').style.display = 'block';
        
        document.getElementById('ds-completed-checkbox').style.display = 'none';
        document.getElementById('ds-alignment-controls').style.display = 'none';
        document.getElementById('ds-status').innerText = "Page Configuration";
        
        const activePage = state.pages.find(p => p.id === uiState.activePageId);
        document.getElementById('ds-title').innerText = activePage ? activePage.title : "Root Grimoire";
        document.getElementById('ds-title').setAttribute('contenteditable', 'false');
        
        if (activePage && activePage.settings) {
            document.getElementById('ps-subtasks-row').value = activePage.settings.subtasksPerRow;
            document.getElementById('ps-default-align').value = activePage.settings.defaultAlignment;
            document.getElementById('ps-grid-size').value = activePage.settings.gridSize;
            document.getElementById('ps-snap-toggle').checked = activePage.settings.snapToGrid;
        }
    }

    const tasksList = document.getElementById('ds-nested-tasks-list');
    const infoList = document.getElementById('ds-nested-info-list');
    tasksList.innerHTML = '';
    infoList.innerHTML = '';
    
    const children = state.nodes.filter(n => n.parentId === activeNodeId && n.pageId === uiState.activePageId);
    children.forEach(child => {
        if (child.type === 'task') tasksList.appendChild(createNestedNodeUI(child));
        else if (child.type === 'info') infoList.appendChild(createNestedNodeUI(child));
    });
}

function updateActiveNodeFromUI() {
    let activeNodeId = uiState.selectedNodeIds.size === 1 ? Array.from(uiState.selectedNodeIds)[0] : uiState.currentCanvasId;
    if (!activeNodeId) return;
    const node = state.nodes.find(n => n.id === activeNodeId);
    if (node) {
        node.title = document.getElementById('ds-title').innerText;
        node.description = document.getElementById('ds-description').value;
        saveState();
        renderAll();
        renderBreadcrumbs();
    }
}

function createNestedNodeUI(childNode) {
    const item = document.createElement('div');
    item.className = 'subtask-item';
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.gap = '8px';
    
    let checkboxHtml = '';
    if (childNode.type === 'task') {
        const checked = childNode.completed ? 'checked' : '';
        checkboxHtml = `<input type="checkbox" class="task-checkbox" ${checked}>`;
    }

    item.innerHTML = `
        ${checkboxHtml}
        <input type="text" class="nested-node-title-input" value="${childNode.title.replace(/"/g, '&quot;')}" 
            style="flex-grow:1; font-family:inherit; font-size:14px; background:transparent; border:none; border-bottom: 1px solid transparent; outline:none; color:inherit; transition: border-color 0.2s; ${childNode.completed ? 'text-decoration:line-through; opacity:0.6;' : ''}">
        <button class="icon-btn enter-btn" title="Enter Bubble" style="width:24px; height:24px; padding:0; font-size:12px; border-radius:4px;">➜</button>
        <button class="text-btn danger delete-btn" style="width:auto; padding: 0 4px;" title="Delete">✕</button>
    `;
    
    if (childNode.type === 'task') {
        const cb = item.querySelector('.task-checkbox');
        cb.addEventListener('change', (e) => {
            window.toggleTaskComplete(childNode.id, e.target.checked);
        });
    }

    const inputEl = item.querySelector('.nested-node-title-input');
    inputEl.addEventListener('focus', () => {
        inputEl.style.borderBottom = '1px solid var(--color-surface-border)';
    });
    inputEl.addEventListener('blur', () => {
        inputEl.style.borderBottom = '1px solid transparent';
    });
    inputEl.addEventListener('input', (e) => {
        childNode.title = e.target.value;
    });
    inputEl.addEventListener('change', (e) => {
        childNode.title = e.target.value;
        saveState();
        renderAll();
    });

    const enterBtn = item.querySelector('.enter-btn');
    enterBtn.addEventListener('click', () => {
        enterCanvas(childNode.id);
    });

    const delBtn = item.querySelector('.delete-btn');
    delBtn.addEventListener('click', () => {
        deleteNode(childNode.id);
        updateSidebarUI();
        renderAll();
    });

    return item;
}

window.toggleTaskComplete = function(id, isChecked) {
    const node = state.nodes.find(n => n.id === id);
    if (node) {
        node.completed = isChecked;
        saveState();
        updateSidebarUI();
        renderAll();
    }
}

function addNestedNodeToUI(type) {
    let activeNodeId = uiState.selectedNodeIds.size === 1 ? Array.from(uiState.selectedNodeIds)[0] : uiState.currentCanvasId;
    if (activeNodeId === undefined) return;
    const newNode = {
        id: generateId(),
        type: type,
        x: Math.random() * 200 + 50,
        y: Math.random() * 200 + 50,
        title: type === 'task' ? 'New Task Bubble' : 'New Info Bubble',
        description: '',
        completed: false,
        parentId: activeNodeId,
        pageId: uiState.activePageId
    };
    state.nodes.push(newNode);
    saveState();
    updateSidebarUI();
    renderAll();
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('icon-sun').style.display = theme === 'dark' ? 'block' : 'none';
    document.getElementById('icon-moon').style.display = theme === 'light' ? 'block' : 'none';
    applyCustomColors(theme);
}

function applyCustomColors(theme) {
    document.documentElement.style = '';
    if (state.settings && state.settings.customColors && state.settings.customColors[theme]) {
        const colors = state.settings.customColors[theme];
        for (const [key, value] of Object.entries(colors)) {
            document.documentElement.style.setProperty(key, value);
        }
    }
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        isUndoAction = true;
        
        try {
            state = JSON.parse(historyStack[historyIndex]);
            saveState(); // Will save to local storage but won't append to history stack
            
            uiState.selectedNodeIds.clear();
            uiState.selectedEdgeId = null;
            uiState.isDraggingNode = false;
            uiState.isConnecting = false;
            uiState.isPanning = false;
            uiState.isSelecting = false;
            uiState.isResizing = false;
            
            applyTheme(state.theme);
            if (state.pages.length === 0) {
                setupDefaultState();
            } else if (!state.pages.find(p => p.id === uiState.activePageId)) {
                uiState.activePageId = state.pages[0].id;
                uiState.currentCanvasId = null;
            }
            
            applyPageSettings();
            renderPagesList();
            renderBreadcrumbs();
            renderAll();
            updateSidebarUI();
        } catch (e) {
            console.error("Undo failed", e);
        } finally {
            isUndoAction = false;
        }
    }
}

function redo() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        isUndoAction = true;
        
        try {
            state = JSON.parse(historyStack[historyIndex]);
            saveState();
            
            uiState.selectedNodeIds.clear();
            uiState.selectedEdgeId = null;
            
            applyTheme(state.theme);
            if (!state.pages.find(p => p.id === uiState.activePageId)) {
                uiState.activePageId = state.pages[0].id;
                uiState.currentCanvasId = null;
            }
            
            applyPageSettings();
            renderPagesList();
            renderBreadcrumbs();
            renderAll();
            updateSidebarUI();
        } catch (e) {
            console.error("Redo failed", e);
        } finally {
            isUndoAction = false;
        }
    }
}
// ==========================================
// Settings Modal & Logic
// ==========================================
const settingsToggle = document.getElementById('settings-toggle');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsTabs = document.querySelectorAll('.settings-tab');
const settingsPanes = document.querySelectorAll('.settings-pane');

const scModeSelect = document.getElementById('sc-mode-select');
const scInputsContainer = document.getElementById('sc-inputs');
const scResetBtn = document.getElementById('sc-reset');

const dbExportBtn = document.getElementById('db-export');
const dbImportBtn = document.getElementById('db-import-btn');
const dbImportFile = document.getElementById('db-import-file');

const themeVariables = [
    { id: '--color-bg', label: 'Background' },
    { id: '--color-text-main', label: 'Main Text' },
    { id: '--color-text-muted', label: 'Muted Text' },
    { id: '--color-accent-gold', label: 'Primary Theme Color' },
    { id: '--color-accent-blue', label: 'Secondary Theme Color' },
    { id: '--color-accent-green', label: 'Success Color' },
    { id: '--color-danger', label: 'Danger Color' },
    { id: '--color-accent-purple', label: 'Purple Theme Color' },
    { id: '--color-accent-slate', label: 'Slate Theme Color' }
];

function rgbToHex(rgbStr) {
    if (rgbStr.startsWith('#')) return rgbStr;
    const match = rgbStr.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return '#ffffff';
    return "#" + (1 << 24 | match[1] << 16 | match[2] << 8 | match[3]).toString(16).slice(1);
}

function setupSettings() {
    // Open / Close Modal
    settingsToggle.addEventListener('click', () => {
        settingsModal.style.display = 'flex';
        settingsBackdrop.style.display = 'block';
        renderColorInputs();
    });

    const closeSettings = () => {
        settingsModal.style.display = 'none';
        settingsBackdrop.style.display = 'none';
    };
    closeSettingsBtn.addEventListener('click', closeSettings);
    settingsBackdrop.addEventListener('click', closeSettings);

    // Tabs
    settingsTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            settingsTabs.forEach(t => t.classList.remove('active'));
            settingsPanes.forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.target).classList.add('active');
        });
    });

    // Color Mode Select
    scModeSelect.value = state.theme;
    scModeSelect.addEventListener('change', () => {
        renderColorInputs();
    });

    // Reset Colors
    scResetBtn.addEventListener('click', () => {
        const mode = scModeSelect.value;
        state.settings.customColors[mode] = {};
        saveState();
        applyCustomColors(state.theme);
        renderColorInputs();
    });

    // Database Export
    dbExportBtn.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "grimoire_workspace.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    });

    // Database Import
    dbImportBtn.addEventListener('click', () => {
        dbImportFile.click();
    });
    
    dbImportFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target.result);
                if (parsed && parsed.pages && parsed.nodes) {
                    localStorage.setItem('grimoire_state_v3', JSON.stringify(parsed));
                    window.location.reload();
                } else {
                    alert('Invalid Grimoire Workspace file.');
                }
            } catch (err) {
                alert('Error parsing the file.');
            }
        };
        reader.readAsText(file);
    });
}

function renderColorInputs() {
    const mode = scModeSelect.value;
    scInputsContainer.innerHTML = '';
    
    // Temporarily apply the selected mode to get computed styles if needed
    // But actually, we want the default computed styles.
    // Let's just create an invisible div with the theme applied
    const tempDiv = document.createElement('div');
    if (mode === 'dark') tempDiv.setAttribute('data-theme', 'dark');
    document.body.appendChild(tempDiv);
    const computed = getComputedStyle(tempDiv);

    themeVariables.forEach(v => {
        const container = document.createElement('div');
        container.className = 'color-setting-item';
        
        const label = document.createElement('label');
        label.textContent = v.label;
        
        const input = document.createElement('input');
        input.type = 'color';
        
        // Get current overridden color, or fallback to default CSS
        let currentColor = state.settings.customColors[mode][v.id];
        if (!currentColor) {
            currentColor = computed.getPropertyValue(v.id).trim();
        }
        
        input.value = rgbToHex(currentColor);
        
        input.addEventListener('input', (e) => {
            state.settings.customColors[mode][v.id] = e.target.value;
            saveState();
            if (state.theme === mode) {
                applyCustomColors(state.theme);
            }
        });
        
        container.appendChild(label);
        container.appendChild(input);
        scInputsContainer.appendChild(container);
    });
    
    document.body.removeChild(tempDiv);
}

setupSettings();
init();
