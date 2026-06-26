// Utility to generate unique IDs
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Helper to determine canonical port pair key for grouping sibling edges
function getEdgePortKey(e) {
    const nodeA = e.source < e.target ? e.source : e.target;
    const nodeB = e.source < e.target ? e.target : e.source;
    const portA = e.source < e.target ? (e.sourcePort || 'auto') : (e.targetPort || 'auto');
    const portB = e.source < e.target ? (e.targetPort || 'auto') : (e.sourcePort || 'auto');
    return `${nodeA}:${portA}-${nodeB}:${portB}`;
}

// Global State
let clipboardData = { nodes: [], edges: [] };
let state = {
    pages: [], // { id, title, settings }
    nodes: [], // { id, x, y, type, title, description, parentId, pageId, completed, textAlign, width, height }
    edges: [], // { id, source, target }
    theme: 'light',
    templates: [],
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
    resizeDirection: null,
    resizeStartMouse: { x: 0, y: 0 },
    resizeStartData: null,
    dragExtraIds: new Set(),
    draggedEdgeId: null,
    draggedEdgeType: null,
    isDraggingLabel: false,
    draggedLabelId: null,
    isDraggingRoutingHandle: false,
    routingDragStartMouse: { x: 0, y: 0 },
    routingDragStartOffset: 0,
    routingDragAxis: 'x',
    routingDragHandleType: 'offset',
    routingDragStartWaypoints: null,
    routingDragSegmentIndex: 0,
    routingDragPointsLength: 0,
    routingDragWpIdx1: -1,
    routingDragWpIdx2: -1,
    isDraggingMinimap: false
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
    updateMinimapVisibility();
    applyMinimapScale();
    applyHudScale();
    renderPagesList();
    renderTemplatesList();
    renderBreadcrumbs();
    renderAll();
    setupEventListeners();
    setupSidebarResizers();
    updateSidebarUI();
    initCollaboration();
    initDrawing();
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
    syncStateToYjs();
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
            state.templates = parsed.templates || [];
            state.settings = parsed.settings || { customColors: { light: {}, dark: {} } };
            if (state.settings.minimapVisible === undefined) {
                state.settings.minimapVisible = true;
            }
            if (state.settings.minimapScale === undefined) {
                state.settings.minimapScale = 1;
            }
            if (state.settings.hudScale === undefined) {
                state.settings.hudScale = 1;
            }
            if (state.settings.typeToEditTitle === undefined) {
                state.settings.typeToEditTitle = true;
            }
            if (state.settings.showDeadlines === undefined) state.settings.showDeadlines = true;
            if (state.settings.showSubtaskDeadlines === undefined) state.settings.showSubtaskDeadlines = true;
            if (state.settings.nearDeadlineDays === undefined) state.settings.nearDeadlineDays = 3;
            if (state.settings.showTimeRemaining === undefined) state.settings.showTimeRemaining = false;
            if (state.settings.deadlineEmoji === undefined) state.settings.deadlineEmoji = '🕒';
            
            
            if (parsed.pages && parsed.pages.length > 0) {
                state.pages = parsed.pages.map(p => {
                    if (!p.settings) {
                        p.settings = { subtasksPerRow: 1, defaultAlignment: 'center', gridSize: 40, snapToGrid: false, snapResizeToGrid: false, routingMode: 'bezier' };
                    } else if (!p.settings.routingMode) {
                        p.settings.routingMode = 'bezier';
                    }
                    if (p.settings.overrideDeadlineSettings === undefined) {
                        p.settings.overrideDeadlineSettings = false;
                        p.settings.showDeadlines = true;
                        p.settings.showSubtaskDeadlines = true;
                        p.settings.nearDeadlineDays = 3;
                        p.settings.showTimeRemaining = false;
                    }
                    if (p.settings.deadlineEmoji === undefined) {
                        p.settings.deadlineEmoji = '🕒';
                    }
                    return p;
                });
            } else {
                state.pages = [{ 
                    id: 'default-page', 
                    title: 'Main Workspace',
                    settings: { subtasksPerRow: 1, defaultAlignment: 'center', gridSize: 40, snapToGrid: false, snapResizeToGrid: false, routingMode: 'bezier', overrideDeadlineSettings: false, showDeadlines: true, showSubtaskDeadlines: true, nearDeadlineDays: 3, deadlineEmoji: '🕒', showTimeRemaining: false }
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
            
            state.drawings = parsed.drawings || [];
            
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
        settings: { subtasksPerRow: 1, defaultAlignment: 'center', gridSize: 40, snapToGrid: false, snapResizeToGrid: false, routingMode: 'bezier', overrideDeadlineSettings: false, showDeadlines: true, showSubtaskDeadlines: true, nearDeadlineDays: 3, deadlineEmoji: '🕒', showTimeRemaining: false }
    }];
    state.templates = [];
    state.drawings = [];
    state.settings = { customColors: { light: {}, dark: {} }, minimapVisible: true, minimapScale: 1, hudScale: 1, typeToEditTitle: true, showDeadlines: true, showSubtaskDeadlines: true, nearDeadlineDays: 3, deadlineEmoji: '🕒', showTimeRemaining: false };
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
        settings: { subtasksPerRow: 1, defaultAlignment: 'center', gridSize: 40, snapToGrid: false, snapResizeToGrid: false, routingMode: 'bezier', overrideDeadlineSettings: false, showDeadlines: true, showSubtaskDeadlines: true, nearDeadlineDays: 3 }
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
    
    const drawingsGroup = document.getElementById('drawings-group');
    if (drawingsGroup) {
        drawingsGroup.innerHTML = '';
        drawingsGroup.setAttribute('transform', `translate(${uiState.canvasOffset.x}, ${uiState.canvasOffset.y}) scale(${uiState.zoom})`);
    }

    nodesContainer.style.transform = `translate(${uiState.canvasOffset.x}px, ${uiState.canvasOffset.y}px) scale(${uiState.zoom})`;
    labelsContainer.style.transform = `translate(${uiState.canvasOffset.x}px, ${uiState.canvasOffset.y}px) scale(${uiState.zoom})`;
    edgesGroup.setAttribute('transform', `translate(${uiState.canvasOffset.x}, ${uiState.canvasOffset.y}) scale(${uiState.zoom})`);
    drawingEdge.setAttribute('transform', `translate(${uiState.canvasOffset.x}, ${uiState.canvasOffset.y}) scale(${uiState.zoom})`);
    
    const visibleNodes = state.nodes.filter(n => n.parentId === uiState.currentCanvasId && n.pageId === uiState.activePageId);
    visibleNodes.forEach(renderNode);
    
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = state.edges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
    visibleEdges.forEach(renderEdge);
    
    renderDrawings();
    renderMinimap(visibleNodes);
}

function resizeHandlesHTML(nodeId) {
    return ['nw','ne','se','sw'].map(dir =>
        `<div class="resize-handle" data-dir="${dir}" data-node="${nodeId}"></div>`
    ).join('');
}

function formatDeadlineDate(isoDate) {
    if (!isoDate) return '';
    // isoDate is YYYY-MM-DD. Parse parts to avoid timezone issues.
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    let year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    // Clamp year to max 4 digits (max 9999)
    if (year > 9999) year = 9999;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${day} ${months[month - 1]} ${year}`;
}

function clampDateInputYear(input) {
    if (!input.value) return;
    const parts = input.value.split('-');
    if (parts.length === 3 && parts[0].length > 4) {
        parts[0] = parts[0].slice(0, 4);
        input.value = parts.join('-');
    }
}

function getDeadlineColorEx(startStr, endStr, startTimeStr, endTimeStr, nearDays) {
    if (!startStr && !endStr) return { color: 'var(--color-text-muted)', remainingStr: '' };
    
    const now = new Date();
    const effectiveStartStr = startStr ? `${startStr}T${startTimeStr || '00:00'}:00` : null;
    const effectiveEndStr = endStr ? `${endStr}T${endTimeStr || '23:59'}:59` : null;
    
    let targetDate = null;
    let startDate = effectiveStartStr ? new Date(effectiveStartStr) : null;
    let endDate = effectiveEndStr ? new Date(effectiveEndStr) : null;
    
    if (startDate && endDate) {
        if (now < startDate) targetDate = startDate;
        else targetDate = endDate;
    } else {
        targetDate = startDate || endDate;
    }
    
    if (isNaN(targetDate.getTime())) return { color: 'var(--color-text-muted)', remainingStr: '' };
    
    const diffMs = targetDate - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffMins = diffMs / (1000 * 60);
    
    let remainingStr = '';
    if (diffMs < 0) {
        const absMins = Math.abs(diffMins);
        if (absMins < 60) remainingStr = `${Math.floor(absMins)} mins overdue`;
        else if (Math.abs(diffHours) < 24) remainingStr = `${Math.floor(Math.abs(diffHours))} hrs overdue`;
        else remainingStr = `${Math.floor(Math.abs(diffDays))} days overdue`;
    } else {
        if (diffDays >= 1) remainingStr = `${Math.floor(diffDays)} days left`;
        else if (diffHours >= 1) remainingStr = `${Math.floor(diffHours)} hrs left`;
        else remainingStr = `${Math.floor(diffMins)} mins left`;
    }

    let color = 'var(--color-accent-green)';
    if (diffMs < 0) {
        color = 'var(--color-danger)';
    } else if (startDate && endDate && now >= startDate && now <= endDate) {
        color = 'var(--color-accent-gold)';
    } else if (diffDays <= nearDays) {
        color = '#eab308';
    }
    return { color, remainingStr };
}

function getDeadlineColor(startStr, endStr, nearDays) {
    return getDeadlineColorEx(startStr, endStr, '', '', nearDays).color;
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
    el.style.width = 'fit-content';
    el.style.minWidth = nodeData.width ? `${nodeData.width}px` : '180px';
    el.style.maxWidth = '800px';
    
    el.style.height = 'auto';
    el.style.minHeight = nodeData.height ? `${nodeData.height}px` : '80px';

    let content = `
        <div style="width: 0; min-width: 100%;">
            <div class="node-header" style="justify-content: ${nodeData.textAlign === 'left' ? 'flex-start' : nodeData.textAlign === 'right' ? 'flex-end' : 'center'}">
                <span class="node-title" style="text-align: ${nodeData.textAlign || 'center'}; width: 100%; display: block;">${nodeData.title}</span>
            </div>
        </div>
    `;

    const page = state.pages.find(p => p.id === uiState.activePageId);
    let effectiveShowDeadlines = state.settings.showDeadlines !== false;
    let effectiveShowSubtaskDeadlines = state.settings.showSubtaskDeadlines !== false;
    let effectiveShowTimeRemaining = state.settings.showTimeRemaining === true;
    let nearDays = state.settings.nearDeadlineDays !== undefined ? state.settings.nearDeadlineDays : 3;
    let deadlineEmoji = state.settings.deadlineEmoji || '🕒';
    
    if (page && page.settings && page.settings.overrideDeadlineSettings) {
        effectiveShowDeadlines = page.settings.showDeadlines !== false;
        effectiveShowSubtaskDeadlines = page.settings.showSubtaskDeadlines !== false;
        effectiveShowTimeRemaining = page.settings.showTimeRemaining === true;
        nearDays = page.settings.nearDeadlineDays !== undefined ? page.settings.nearDeadlineDays : 3;
        deadlineEmoji = page.settings.deadlineEmoji || '🕒';
    }

    const colorData = getDeadlineColorEx(nodeData.deadlineStart, nodeData.deadlineEnd, nodeData.deadlineStartTime, nodeData.deadlineEndTime, nearDays);
    const color = colorData.color;
    
    let remainingHtml = '';
    // Independent check for time remaining
    if (effectiveShowTimeRemaining && colorData.remainingStr) {
        remainingHtml = `<div style="font-size: 11px; color: ${color}; border: 1px solid ${color}; padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,0.1); white-space: nowrap; font-weight: 600; flex-shrink: 0; width: fit-content;">⏳ ${colorData.remainingStr}</div>`;
    }
    
    // Independent check for deadlines
    if (effectiveShowDeadlines && (nodeData.deadlineStart || nodeData.deadlineEnd)) {
        let deadlineStr = '';
        const tStart = nodeData.deadlineStartTime ? ` ${nodeData.deadlineStartTime}` : '';
        const tEnd = nodeData.deadlineEndTime ? ` ${nodeData.deadlineEndTime}` : '';
        const fStart = nodeData.deadlineStart ? formatDeadlineDate(nodeData.deadlineStart) : '';
        const fEnd = nodeData.deadlineEnd ? formatDeadlineDate(nodeData.deadlineEnd) : '';
        
        if (nodeData.deadlineStart && nodeData.deadlineEnd) {
            deadlineStr = `${fStart}${tStart} – ${fEnd}${tEnd}`;
        } else {
            deadlineStr = nodeData.deadlineStart ? `${fStart}${tStart}` : `${fEnd}${tEnd}`;
        }
        
        content += `<div style="display: flex; gap: 6px; justify-content: center; align-items: center; margin-top: 6px; flex-wrap: nowrap; overflow: hidden; align-self: center;">
            <div class="node-deadline" style="font-size: 11px; color: ${color}; border: 1px solid ${color}; padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,0.1); white-space: nowrap; flex-shrink: 0; width: fit-content;">
                ${deadlineEmoji} ${deadlineStr}
            </div>
            ${remainingHtml}
        </div>`;
    } else if (remainingHtml) {
        content += `<div style="display: flex; justify-content: center; align-items: center; margin-top: 6px; align-self: center;">${remainingHtml}</div>`;
    }


    if (nodeData.type === 'container') {
        content += resizeHandlesHTML(nodeData.id);
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
                startResize(e, nodeData.id, e.target.dataset.dir);
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
        subtasksHtml = taskChildren.map(st => {
            let stDeadline = '';
            if (st.deadlineStart || st.deadlineEnd) {
                const stColorData = getDeadlineColorEx(st.deadlineStart, st.deadlineEnd, st.deadlineStartTime, st.deadlineEndTime, nearDays);
                const stColor = stColorData.color;

                if (effectiveShowSubtaskDeadlines) {
                    const tStart = st.deadlineStartTime ? ` ${st.deadlineStartTime}` : '';
                    const tEnd = st.deadlineEndTime ? ` ${st.deadlineEndTime}` : '';
                    const fStart = st.deadlineStart ? formatDeadlineDate(st.deadlineStart) : '';
                    const fEnd = st.deadlineEnd ? formatDeadlineDate(st.deadlineEnd) : '';
                    let stDeadlineStr = '';
                    if (st.deadlineStart && st.deadlineEnd) {
                        stDeadlineStr = `${fStart}${tStart} – ${fEnd}${tEnd}`;
                    } else {
                        stDeadlineStr = st.deadlineStart ? `${fStart}${tStart}` : `${fEnd}${tEnd}`;
                    }
                    stDeadline += `<span style="opacity: 0.9; margin-left: 6px; border: 1px solid ${stColor}; padding: 2px 4px; border-radius: 3px; color: ${stColor}; white-space: nowrap; flex-shrink: 0;">${deadlineEmoji} ${stDeadlineStr}</span>`;
                }

                if (effectiveShowTimeRemaining && stColorData.remainingStr) {
                    stDeadline += `<span style="opacity: 0.9; margin-left: 4px; border: 1px solid ${stColor}; padding: 2px 4px; border-radius: 3px; color: ${stColor}; white-space: nowrap; font-weight: 600; flex-shrink: 0;">⏳ ${stColorData.remainingStr}</span>`;
                }
            }
            return `<span class="sub-node-pill" style="${st.completed ? 'background:var(--color-accent-green); color:white;' : ''}">${st.title}${stDeadline}</span>`;
        }).join('');
        if (infoChildren.length > 0) {
            subtasksHtml += `<span class="sub-node-pill" style="background: var(--color-accent-blue); color: #fff;">+ ${infoChildren.length} Info</span>`;
        }
    } else if (nodeData.type === 'info') {
        if (children.length > 0) {
            subtasksHtml += `<span class="sub-node-pill" style="background: var(--color-accent-blue); color: #fff;">${children.length} Nested</span>`;
        }
    }

    if (nodeData.description && nodeData.description.trim() !== '') {
        let mdHtml = typeof marked !== 'undefined' ? marked.parse(nodeData.description) : nodeData.description;
        content += `<div style="width: 0; min-width: 100%;"><div class="node-markdown markdown-body" style="margin-top: 8px; font-size: 11px; color: var(--color-text-muted); text-align: left; background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px;">${mdHtml}</div></div>`;
    }

    content += `<div style="width: 0; min-width: 100%;"><div class="sub-nodes-container">${subtasksHtml}</div></div>`;
    
    content += `
        <div class="port port-top" data-node="${nodeData.id}" data-port="top"></div>
        <div class="port port-right" data-node="${nodeData.id}" data-port="right"></div>
        <div class="port port-bottom" data-node="${nodeData.id}" data-port="bottom"></div>
        <div class="port port-left" data-node="${nodeData.id}" data-port="left"></div>
    `;
    content += resizeHandlesHTML(nodeData.id);

    el.innerHTML = content;
    
    el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('resize-handle')) {
            e.stopPropagation();
            startResize(e, nodeData.id, e.target.dataset.dir);
        } else if (!e.target.classList.contains('port')) {
            startNodeDrag(e, nodeData.id);
        }
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

    const lineStyleStr = edgeData.lineStyle === 'dashed' ? '5,5' : edgeData.lineStyle === 'dotted' ? '2,4' : 'none';
    const colorVar = edgeData.color ? `var(--color-accent-${edgeData.color})` : 'var(--color-accent-gold)';
    const colorName = edgeData.color || 'gold';

    const page = state.pages.find(p => p.id === uiState.activePageId);
    const defaultRouting = (page && page.settings && page.settings.routingMode) || 'bezier';
    const edgeRouting = edgeData.routingMode;
    const activeMode = (edgeRouting && edgeRouting !== 'default') ? edgeRouting : defaultRouting;

    const isSelected = uiState.selectedEdgeId === edgeData.id;

    // ── ORTHOGONAL: single path with middle routing grab-handle ──────────────────────────
    if (activeMode === 'orthogonal') {
        const points = getOrthogonalPoints(sPort, tPort, edgeData);
        const path = createSVGPath(sPort, tPort, edgeData);

        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', path);
        pathEl.setAttribute('class', 'edge-path' + (isSelected ? ' selected flowing' : ''));
        pathEl.setAttribute('stroke-dasharray', lineStyleStr);
        pathEl.style.setProperty('--edge-color', colorVar);
        pathEl.id = `edge-${edgeData.id}`;

        pathEl.addEventListener('mouseenter', () => {
            pathEl.classList.add('flowing');
        });
        pathEl.addEventListener('mouseleave', () => {
            if (!isSelected) pathEl.classList.remove('flowing');
        });

        if (edgeData.arrowEnd !== false) {
            pathEl.setAttribute('marker-end', `url(#arrowhead-${colorName})`);
        }
        if (edgeData.arrowStart) {
            pathEl.setAttribute('marker-start', `url(#arrowstart-${colorName})`);
        }

        pathEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isSelected) {
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
            showEdgeContextMenu(e, edgeData.id);
        });

        edgesGroup.appendChild(pathEl);

        // Setup Segment Grab Tracks & Handles (draw.io style dynamic multi-segment editing)
        const N = points.length;
        if (N >= 4) {
            for (let i = 1; i <= N - 3; i++) {
                const pA = points[i];
                const pB = points[i + 1];
                const idx = i;

                if (pA && pB) {
                    const isHoriz = Math.abs(pB.y - pA.y) < 1;
                    const dragAxis = isHoriz ? 'y' : 'x';
                    const cursor = isHoriz ? 'ns-resize' : 'ew-resize';

                    const grabPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    grabPath.setAttribute('d', `M ${pA.x} ${pA.y} L ${pB.x} ${pB.y}`);
                    grabPath.setAttribute('class', 'routing-grab-path');
                    grabPath.setAttribute('stroke-width', '18');
                    grabPath.setAttribute('stroke-linecap', 'round');
                    grabPath.style.cursor = cursor;

                    grabPath.addEventListener('mouseenter', () => {
                        pathEl.classList.add('hovered', 'flowing');
                    });
                    grabPath.addEventListener('mouseleave', () => {
                        pathEl.classList.remove('hovered');
                        if (!isSelected) pathEl.classList.remove('flowing');
                    });

                    grabPath.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        e.preventDefault();

                        uiState.selectedNodeIds.clear();
                        uiState.selectedEdgeId = edgeData.id;
                        
                        uiState.isDraggingRoutingHandle = true;
                        uiState.draggedEdgeId = edgeData.id;
                        uiState.routingDragStartMouse = { x: e.clientX, y: e.clientY };
                        
                        let currentWps = edgeData.waypoints;
                        if (!currentWps || currentWps.length === 0) {
                            currentWps = getEdgeWaypoints(edgeData, sPort, tPort);
                            edgeData.waypoints = currentWps;
                        }
                        uiState.routingDragStartWaypoints = JSON.parse(JSON.stringify(currentWps));
                        uiState.routingDragSegmentIndex = idx;
                        uiState.routingDragPointsLength = N;
                        uiState.routingDragAxis = dragAxis;
                        uiState.routingDragWpIdx1 = idx - 2;
                        uiState.routingDragWpIdx2 = idx - 1;

                        renderAll();
                        updateSidebarUI();
                    });

                    edgesGroup.appendChild(grabPath);

                    // Gold handle at midpoint (shown when selected)
                    if (isSelected) {
                        const midX = (pA.x + pB.x) / 2;
                        const midY = (pA.y + pB.y) / 2;

                        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                        handle.setAttribute('cx', midX);
                        handle.setAttribute('cy', midY);
                        handle.setAttribute('r', '8');
                        handle.setAttribute('class', 'routing-handle');
                        handle.style.cursor = cursor;

                        handle.addEventListener('mouseenter', () => {
                            pathEl.classList.add('hovered');
                        });
                        handle.addEventListener('mouseleave', () => {
                            pathEl.classList.remove('hovered');
                        });

                        handle.addEventListener('mousedown', (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            
                            uiState.selectedNodeIds.clear();
                            uiState.selectedEdgeId = edgeData.id;

                            uiState.isDraggingRoutingHandle = true;
                            uiState.draggedEdgeId = edgeData.id;
                            uiState.routingDragStartMouse = { x: e.clientX, y: e.clientY };
                            
                            let currentWps = edgeData.waypoints;
                            if (!currentWps || currentWps.length === 0) {
                                currentWps = getEdgeWaypoints(edgeData, sPort, tPort);
                                edgeData.waypoints = currentWps;
                            }
                            uiState.routingDragStartWaypoints = JSON.parse(JSON.stringify(currentWps));
                            uiState.routingDragSegmentIndex = idx;
                            uiState.routingDragPointsLength = N;
                            uiState.routingDragAxis = dragAxis;
                            uiState.routingDragWpIdx1 = idx - 2;
                            uiState.routingDragWpIdx2 = idx - 1;

                            renderAll();
                            updateSidebarUI();
                        });

                        handle.addEventListener('dblclick', (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            edgeData.waypoints = null;
                            edgeData.routingOffset = 0;
                            saveState();
                            renderAll();
                            showToast("Routing reset to default.", "success");
                        });

                        edgesGroup.appendChild(handle);
                    }
                }
            }
        }

        // Endpoint drag handles
        if (isSelected) {
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

    // ── BEZIER: single path as before ─────────────────────────────────────────
    } else {
        const path = createSVGPath(sPort, tPort, edgeData);

        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', path);
        pathEl.setAttribute('class', 'edge-path' + (isSelected ? ' selected flowing' : ''));
        pathEl.setAttribute('stroke-dasharray', lineStyleStr);
        pathEl.style.setProperty('--edge-color', colorVar);
        pathEl.id = `edge-${edgeData.id}`;

        pathEl.addEventListener('mouseenter', () => {
            pathEl.classList.add('flowing');
        });
        pathEl.addEventListener('mouseleave', () => {
            if (!isSelected) pathEl.classList.remove('flowing');
        });

        if (edgeData.arrowEnd !== false) {
            pathEl.setAttribute('marker-end', `url(#arrowhead-${colorName})`);
        }
        if (edgeData.arrowStart) {
            pathEl.setAttribute('marker-start', `url(#arrowstart-${colorName})`);
        }

        pathEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isSelected) {
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
            showEdgeContextMenu(e, edgeData.id);
        });

        edgesGroup.appendChild(pathEl);

        if (isSelected) {
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

    // ── Label (shared between both modes) ───────────────────────────────────────
    const dx = tPort.x - sPort.x;
    const dy = tPort.y - sPort.y;
    const dist = Math.sqrt(dx*dx + dy*dy);

    let labelX, labelY;
    const t = edgeData.labelPosition !== undefined ? edgeData.labelPosition : 0.5;

    if (activeMode === 'orthogonal') {
        const pt = getPointOnOrthogonalPath(sPort, tPort, t, edgeData);
        labelX = pt.x;
        labelY = pt.y;
    } else {
        const curve = Math.max(dist * 0.5, 80);
        let c1x = sPort.x + sPort.dir.x * curve;
        let c1y = sPort.y + sPort.dir.y * curve;
        let c2x = tPort.x + tPort.dir.x * curve;
        let c2y = tPort.y + tPort.dir.y * curve;

        const key = getEdgePortKey(edgeData);
        const siblings = state.edges.filter(e => getEdgePortKey(e) === key);
        if (siblings.length > 1) {
            siblings.sort((a, b) => a.id.localeCompare(b.id));
            const index = siblings.findIndex(e => e.id === edgeData.id);
            const count = siblings.length;
            
            const step = 40;
            const mid = (count - 1) / 2;
            const offsetValue = (index - mid) * step;
            
            const nx = -dy / (dist || 1);
            const ny = dx / (dist || 1);
            
            c1x += nx * offsetValue;
            c1y += ny * offsetValue;
            c2x += nx * offsetValue;
            c2y += ny * offsetValue;
        }

        const mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt;
        const t2 = t * t, t3 = t2 * t;

        labelX = mt3 * sPort.x + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t3 * tPort.x;
        labelY = mt3 * sPort.y + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t3 * tPort.y;
    }

    const labelEl = document.createElement('div');
    labelEl.className = 'edge-label';
    labelEl.id = `edge-label-${edgeData.id}`;
    if (isSelected) labelEl.classList.add('selected');
    labelEl.style.left = labelX + 'px';
    labelEl.style.top = labelY + 'px';
    labelEl.innerText = edgeData.text || '';

    if (!edgeData.text && !isSelected) {
        labelEl.style.opacity = '0';
    } else {
        labelEl.style.opacity = '1';
    }

    labelEl.addEventListener('mousedown', (e) => {
        if (labelEl.contentEditable === "true") return;
        e.stopPropagation();
        uiState.isDraggingLabel = true;
        uiState.draggedLabelId = edgeData.id;
        if (!isSelected) {
            uiState.selectedNodeIds.clear();
            uiState.selectedEdgeId = edgeData.id;
            updateSidebarUI();
            labelEl.classList.add('selected');
        }
    });

    labelEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (labelEl.contentEditable === "true") return;
        if (!isSelected) {
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
        showEdgeContextMenu(e, edgeData.id);
    });

    labelsContainer.appendChild(labelEl);
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

function orthogonalizePoints(points, p1Dir) {
    let raw = [points[0]];
    let currentDir = p1Dir.x !== 0 ? 'H' : 'V';

    for (let i = 1; i < points.length; i++) {
        const A = raw[raw.length - 1];
        const B = points[i];

        const dx = B.x - A.x;
        const dy = B.y - A.y;

        if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
            continue; // Skip consecutive duplicates
        }

        if (Math.abs(dx) < 0.1 || Math.abs(dy) < 0.1) {
            raw.push(B);
            if (Math.abs(dx) > 0.1) currentDir = 'H';
            if (Math.abs(dy) > 0.1) currentDir = 'V';
        } else {
            if (currentDir === 'H') {
                raw.push({ x: A.x, y: B.y });
                raw.push(B);
                currentDir = 'H';
            } else {
                raw.push({ x: B.x, y: A.y });
                raw.push(B);
                currentDir = 'V';
            }
        }
    }
    return raw;
}


function getEdgeWaypoints(edgeData, sPort, tPort) {
    if (edgeData && edgeData.waypoints && edgeData.waypoints.length > 0) {
        return edgeData.waypoints;
    }
    const buffer = 30;
    const p1_exit = { x: sPort.x + sPort.dir.x * buffer, y: sPort.y + sPort.dir.y * buffer };
    const p2_enter = { x: tPort.x + tPort.dir.x * buffer, y: tPort.y + tPort.dir.y * buffer };

    let waypoints = [];
    let offset = (edgeData && edgeData.routingOffset) || 0;
    if (offset === 0 && edgeData) {
        const key = getEdgePortKey(edgeData);
        const siblings = state.edges.filter(e => getEdgePortKey(e) === key);
        if (siblings.length > 1) {
            siblings.sort((a, b) => a.id.localeCompare(b.id));
            const index = siblings.findIndex(e => e.id === edgeData.id);
            const count = siblings.length;
            
            const step = 40;
            const mid = (count - 1) / 2;
            offset = (index - mid) * step;
        }
    }
    if (sPort.dir.x !== 0) {
        if (tPort.dir.x !== 0) {
            const midX = (p1_exit.x + p2_enter.x) / 2 + offset;
            waypoints.push({ x: midX, y: p1_exit.y });
            waypoints.push({ x: midX, y: p2_enter.y });
        } else {
            const midX = p2_enter.x + offset;
            waypoints.push({ x: midX, y: p1_exit.y });
            waypoints.push({ x: midX, y: p2_enter.y });
        }
    } else {
        if (tPort.dir.y !== 0) {
            const midY = (p1_exit.y + p2_enter.y) / 2 + offset;
            waypoints.push({ x: p1_exit.x, y: midY });
            waypoints.push({ x: p2_enter.x, y: midY });
        } else {
            const midY = p2_enter.y + offset;
            waypoints.push({ x: p1_exit.x, y: midY });
            waypoints.push({ x: p2_enter.x, y: midY });
        }
    }
    return waypoints;
}

function getOrthogonalPoints(p1, p2, edgeData) {
    const buffer = 30;
    const p1_exit = { x: p1.x + p1.dir.x * buffer, y: p1.y + p1.dir.y * buffer };
    const p2_enter = { x: p2.x + p2.dir.x * buffer, y: p2.y + p2.dir.y * buffer };

    const waypoints = getEdgeWaypoints(edgeData, p1, p2);
    let points = [p1, p1_exit, ...waypoints, p2_enter, p2];
    
    return orthogonalizePoints(points, p1.dir);
}

function getPointOnOrthogonalPath(p1, p2, t, edgeData) {
    const points = getOrthogonalPoints(p1, p2, edgeData);
    let totalLength = 0;
    let segments = [];
    for (let i = 0; i < points.length - 1; i++) {
        const dx = points[i+1].x - points[i].x;
        const dy = points[i+1].y - points[i].y;
        const len = Math.sqrt(dx*dx + dy*dy);
        totalLength += len;
        segments.push({ p1: points[i], p2: points[i+1], len: len });
    }
    
    if (totalLength === 0) return p1;
    
    let targetDist = t * totalLength;
    let currentDist = 0;
    
    for (let seg of segments) {
        if (currentDist + seg.len >= targetDist) {
            const remain = targetDist - currentDist;
            const ratio = remain / seg.len;
            return {
                x: seg.p1.x + (seg.p2.x - seg.p1.x) * ratio,
                y: seg.p1.y + (seg.p2.y - seg.p1.y) * ratio
            };
        }
        currentDist += seg.len;
    }
    return points[points.length - 1];
}

function createOrthogonalPath(p1, p2, edgeData, cornerRadius = 12) {
    const points = getOrthogonalPoints(p1, p2, edgeData);
    if (points.length === 0) return '';
    
    let path = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i-1];
        const curr = points[i];
        const next = points[i+1];
        
        const dx1 = prev.x - curr.x;
        const dy1 = prev.y - curr.y;
        const len1 = Math.sqrt(dx1*dx1 + dy1*dy1);
        
        const dx2 = next.x - curr.x;
        const dy2 = next.y - curr.y;
        const len2 = Math.sqrt(dx2*dx2 + dy2*dy2);
        
        const r = Math.min(cornerRadius, len1 / 3, len2 / 3);
        
        if (r > 0) {
            const pStart = {
                x: curr.x + (dx1 / len1) * r,
                y: curr.y + (dy1 / len1) * r
            };
            const pEnd = {
                x: curr.x + (dx2 / len2) * r,
                y: curr.y + (dy2 / len2) * r
            };
            
            path += ` L ${pStart.x} ${pStart.y}`;
            path += ` Q ${curr.x} ${curr.y}, ${pEnd.x} ${pEnd.y}`;
        } else {
            path += ` L ${curr.x} ${curr.y}`;
        }
    }
    
    path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    return path;
}

function createSVGPath(p1, p2, edgeData) {
    const page = state.pages.find(p => p.id === uiState.activePageId);
    const defaultRouting = (page && page.settings && page.settings.routingMode) || 'bezier';
    const edgeRouting = edgeData && edgeData.routingMode;
    const activeMode = (edgeRouting && edgeRouting !== 'default') ? edgeRouting : defaultRouting;

    if (activeMode === 'orthogonal') {
        return createOrthogonalPath(p1, p2, edgeData);
    }

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const curve = Math.max(dist * 0.5, 80);
    
    let c1x = p1.x + p1.dir.x * curve;
    let c1y = p1.y + p1.dir.y * curve;
    
    let c2x = p2.x + p2.dir.x * curve;
    let c2y = p2.y + p2.dir.y * curve;
    
    if (edgeData) {
        const key = getEdgePortKey(edgeData);
        const siblings = state.edges.filter(e => getEdgePortKey(e) === key);
        if (siblings.length > 1) {
            siblings.sort((a, b) => a.id.localeCompare(b.id));
            const index = siblings.findIndex(e => e.id === edgeData.id);
            const count = siblings.length;
            
            const step = 40; // spacing between curves
            const mid = (count - 1) / 2;
            const offsetValue = (index - mid) * step;
            
            const nx = -dy / (dist || 1);
            const ny = dx / (dist || 1);
            
            c1x += nx * offsetValue;
            c1y += ny * offsetValue;
            c2x += nx * offsetValue;
            c2y += ny * offsetValue;
        }
    }
    
    return `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
}

// Minimap
function updateMinimapVisibility() {
    const minimapContainer = document.getElementById('minimap-container');
    const minimapToggleBtn = document.getElementById('minimap-toggle');
    if (!minimapContainer || !minimapToggleBtn) return;

    if (state.settings.minimapVisible !== false) {
        minimapContainer.classList.remove('collapsed');
        minimapToggleBtn.classList.add('active');
    } else {
        minimapContainer.classList.add('collapsed');
        minimapToggleBtn.classList.remove('active');
    }
}

function applyHudScale() {
    const scale = state.settings.hudScale || 1;
    document.documentElement.style.setProperty('--hud-scale', scale);
    
    // Refresh label in modal if open
    const label = document.getElementById('hud-size-label');
    const pct = Math.round(scale * 100) + '%';
    if (label) label.textContent = pct;
}

function applyMinimapScale() {
    const scale = state.settings.minimapScale || 1;
    const baseW = 200, baseH = 150;
    const w = Math.round(baseW * scale);
    const h = Math.round(baseH * scale);
    const container = document.getElementById('minimap-container');
    if (container) {
        container.style.width = w + 'px';
        container.style.height = h + 'px';
    }
    // Refresh label in modal if open
    const label = document.getElementById('ms-size-label');
    const pct = Math.round(scale * 100) + '%';
    if (label) label.textContent = pct;
    // Re-render minimap with new dimensions
    const visibleNodes = state.nodes.filter(n => n.parentId === uiState.currentCanvasId && n.pageId === uiState.activePageId);
    renderMinimap(visibleNodes);
}

function getMinimapMetrics() {
    const visibleNodes = state.nodes.filter(n => n.parentId === uiState.currentCanvasId && n.pageId === uiState.activePageId);
    if (visibleNodes.length === 0) return null;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visibleNodes.forEach(n => {
        const nodeEl = document.getElementById(`node-${n.id}`);
        const w = nodeEl ? nodeEl.offsetWidth : (n.width || (n.type === 'container' ? 400 : 180));
        const h = nodeEl ? nodeEl.offsetHeight : (n.height || (n.type === 'container' ? 300 : 80));
        
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + w);
        maxY = Math.max(maxY, n.y + h);
    });
    
    minX -= 400; minY -= 400; maxX += 400; maxY += 400;
    
    const container = document.getElementById('minimap-container');
    const mmW = container ? container.offsetWidth : 200;
    const mmH = container ? container.offsetHeight : 150;
    const mapWidth = maxX - minX;
    const mapHeight = maxY - minY;
    const scale = Math.min(mmW / mapWidth, mmH / mapHeight);
    
    const vpW = (window.innerWidth / uiState.zoom) * scale;
    const vpH = (window.innerHeight / uiState.zoom) * scale;
    
    return { minX, minY, scale, vpW, vpH, mmW, mmH };
}

function panCanvasToMinimapPosition(clientX, clientY) {
    const metrics = getMinimapMetrics();
    if (!metrics) return;
    
    const container = document.getElementById('minimap-container');
    const rect = container.getBoundingClientRect();
    
    // Clamp mouse positions to within the actual minimap boundaries
    const mouseX = Math.max(0, Math.min(clientX - rect.left, metrics.mmW));
    const mouseY = Math.max(0, Math.min(clientY - rect.top, metrics.mmH));
    
    // Center the viewport at the mouse position
    const vpX = mouseX - metrics.vpW / 2;
    const vpY = mouseY - metrics.vpH / 2;
    
    // Convert back to canvasOffset
    uiState.canvasOffset.x = -(vpX / metrics.scale + metrics.minX) * uiState.zoom;
    uiState.canvasOffset.y = -(vpY / metrics.scale + metrics.minY) * uiState.zoom;
    
    renderAll();
}

function renderMinimap(visibleNodes) {
    minimapContent.innerHTML = '';
    if (visibleNodes.length === 0) {
        minimapViewport.style.display = 'none';
        return;
    }
    minimapViewport.style.display = 'block';
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visibleNodes.forEach(n => {
        const nodeEl = document.getElementById(`node-${n.id}`);
        const w = nodeEl ? nodeEl.offsetWidth : (n.width || (n.type === 'container' ? 400 : 180));
        const h = nodeEl ? nodeEl.offsetHeight : (n.height || (n.type === 'container' ? 300 : 80));
        
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + w);
        maxY = Math.max(maxY, n.y + h);
    });
    
    minX -= 400; minY -= 400; maxX += 400; maxY += 400;
    
    const mmContainer = document.getElementById('minimap-container');
    const mmW = mmContainer ? mmContainer.offsetWidth : 200;
    const mmH = mmContainer ? mmContainer.offsetHeight : 150;
    const mapWidth = maxX - minX;
    const mapHeight = maxY - minY;
    const scale = Math.min(mmW / mapWidth, mmH / mapHeight);
    
    visibleNodes.forEach(n => {
        const nodeEl = document.getElementById(`node-${n.id}`);
        const w = nodeEl ? nodeEl.offsetWidth : (n.width || (n.type === 'container' ? 400 : 180));
        const h = nodeEl ? nodeEl.offsetHeight : (n.height || (n.type === 'container' ? 300 : 80));
        
        const el = document.createElement('div');
        el.className = `minimap-node node-type-${n.type}`;
        if (n.completed) el.classList.add('completed-node');
        if (n.color) el.classList.add(`color-theme-${n.color}`);
        if (uiState.selectedNodeIds.has(n.id)) el.classList.add('selected');
        
        el.style.left = (n.x - minX) * scale + 'px';
        el.style.top = (n.y - minY) * scale + 'px';
        el.style.width = w * scale + 'px';
        el.style.height = h * scale + 'px';
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
            document.getElementById('zoom-controls').style.left = '20px';
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

    const minimapToggle = document.getElementById('minimap-toggle');
    if (minimapToggle) {
        minimapToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            state.settings.minimapVisible = state.settings.minimapVisible !== false ? false : true;
            saveState();
            updateMinimapVisibility();
        });
    }

    const minimapContainer = document.getElementById('minimap-container');
    if (minimapContainer) {
        minimapContainer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uiState.isDraggingMinimap = true;
            const vp = document.getElementById('minimap-viewport');
            if (vp) vp.classList.add('dragging');
            panCanvasToMinimapPosition(e.clientX, e.clientY);
        });

        minimapContainer.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const visibleNodes = state.nodes.filter(n => n.parentId === uiState.currentCanvasId && n.pageId === uiState.activePageId);
            if (visibleNodes.length === 0) {
                uiState.canvasOffset = {x:0, y:0};
                setZoom(1);
                return;
            }

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            visibleNodes.forEach(n => {
                const nodeEl = document.getElementById(`node-${n.id}`);
                const w = nodeEl ? nodeEl.offsetWidth : (n.width || (n.type === 'container' ? 400 : 180));
                const h = nodeEl ? nodeEl.offsetHeight : (n.height || (n.type === 'container' ? 300 : 80));
                
                minX = Math.min(minX, n.x);
                minY = Math.min(minY, n.y);
                maxX = Math.max(maxX, n.x + w);
                maxY = Math.max(maxY, n.y + h);
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
    }

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
        if (uiState.drawingMode === 'draw') {
            uiState.isDrawing = true;
            const rect = workspace.getBoundingClientRect();
            const x = (e.clientX - rect.left - uiState.canvasOffset.x) / uiState.zoom;
            const y = (e.clientY - rect.top - uiState.canvasOffset.y) / uiState.zoom;
            
            uiState.currentDrawingPath = {
                id: 'path-' + generateId(),
                points: [{ x, y }],
                color: uiState.drawingColor || 'gold',
                strokeWidth: uiState.drawingStrokeWidth || 4,
                pageId: uiState.activePageId,
                canvasId: uiState.currentCanvasId
            };
            return;
        }

        if (e.target.id === 'workspace' || e.target.id === 'edges-canvas' || e.target.id === 'nodes-container' || e.target.id === 'drawings-group') {
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

    window.addEventListener('keydown', (e) => {
        // "Type to edit title" feature
        if (uiState.selectedNodeIds.size === 1 && state.settings.typeToEditTitle !== false) {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isTyping = activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable;
            
            if (!isTyping) {
                // Single character keys, excluding control shortcuts
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    const dsTitle = document.getElementById('ds-title');
                    if (dsTitle) {
                        dsTitle.focus();
                        dsTitle.textContent = e.key;
                        updateActiveNodeFromUI();
                        
                        // Place cursor at the end
                        const range = document.createRange();
                        const sel = window.getSelection();
                        range.selectNodeContents(dsTitle);
                        range.collapse(false);
                        sel.removeAllRanges();
                        sel.addRange(range);
                        
                        e.preventDefault();
                    }
                }
            }
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (uiState.isDrawing && uiState.drawingMode === 'draw' && uiState.currentDrawingPath) {
            const rect = workspace.getBoundingClientRect();
            const x = (e.clientX - rect.left - uiState.canvasOffset.x) / uiState.zoom;
            const y = (e.clientY - rect.top - uiState.canvasOffset.y) / uiState.zoom;
            
            uiState.currentDrawingPath.points.push({ x, y });
            renderActiveDrawingPath();
            return;
        }

        if (uiState.isDraggingMinimap) {
            panCanvasToMinimapPosition(e.clientX, e.clientY);
        } else if (uiState.isResizing) {
            const node = state.nodes.find(n => n.id === uiState.resizeNodeId);
            if (node && uiState.resizeStartData) {
                const rawDx = (e.clientX - uiState.resizeStartMouse.x) / uiState.zoom;
                const rawDy = (e.clientY - uiState.resizeStartMouse.y) / uiState.zoom;
                const { x: ox, y: oy, width: ow, height: oh } = uiState.resizeStartData;
                const dir = uiState.resizeDirection;
                const MIN_W = 80, MIN_H = 50;

                let nx = ox, ny = oy, nw = ow, nh = oh;

                // Horizontal component
                if (dir.includes('e')) { nw = Math.max(MIN_W, ow + rawDx); }
                if (dir.includes('w')) { const dw = Math.min(rawDx, ow - MIN_W); nw = ow - dw; nx = ox + dw; }

                // Vertical component
                if (dir.includes('s')) { nh = Math.max(MIN_H, oh + rawDy); }
                if (dir.includes('n')) { const dh = Math.min(rawDy, oh - MIN_H); nh = oh - dh; ny = oy + dh; }

                const page = state.pages.find(p => p.id === uiState.activePageId);
                if (page && page.settings && page.settings.snapResizeToGrid) {
                    const gridSize = page.settings.gridSize || 40;
                    if (dir.includes('e')) {
                        nw = Math.max(MIN_W, Math.round((nx + nw) / gridSize) * gridSize - nx);
                    }
                    if (dir.includes('w')) {
                        const rightEdge = nx + nw;
                        nx = Math.round(nx / gridSize) * gridSize;
                        nw = Math.max(MIN_W, rightEdge - nx);
                    }
                    if (dir.includes('s')) {
                        nh = Math.max(MIN_H, Math.round((ny + nh) / gridSize) * gridSize - ny);
                    }
                    if (dir.includes('n')) {
                        const bottomEdge = ny + nh;
                        ny = Math.round(ny / gridSize) * gridSize;
                        nh = Math.max(MIN_H, bottomEdge - ny);
                    }
                }

                node.x = nx; node.y = ny;
                node.width = nw; node.height = nh;
                renderAll();
            }
        } else if (uiState.isDraggingRoutingHandle) {
            const edge = state.edges.find(ed => ed.id === uiState.draggedEdgeId);
            if (edge && uiState.routingDragStartWaypoints) {
                const dx = (e.clientX - uiState.routingDragStartMouse.x) / uiState.zoom;
                const dy = (e.clientY - uiState.routingDragStartMouse.y) / uiState.zoom;
                let delta = uiState.routingDragAxis === 'x' ? dx : dy;

                // Clamp to Grid Snapping with Double the Resolution
                const page = state.pages.find(p => p.id === uiState.activePageId);
                if (page && page.settings && page.settings.snapToGrid) {
                    const gridSize = page.settings.gridSize || 40;
                    const snapRes = gridSize / 2; // Snapping with double the resolution (half the grid size)
                    delta = Math.round(delta / snapRes) * snapRes;
                }

                // Clone start waypoints
                let wps = JSON.parse(JSON.stringify(uiState.routingDragStartWaypoints));
                const axis = uiState.routingDragAxis;

                const wpIdx1 = uiState.routingDragWpIdx1;
                const wpIdx2 = uiState.routingDragWpIdx2;

                if (wpIdx1 >= 0 && wps[wpIdx1]) {
                    wps[wpIdx1][axis] += delta;
                }
                if (wpIdx2 >= 0 && wps[wpIdx2]) {
                    wps[wpIdx2][axis] += delta;
                }

                edge.waypoints = wps;
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
                let c1x = sPort.x + sPort.dir.x * curve;
                let c1y = sPort.y + sPort.dir.y * curve;
                let c2x = tPort.x + tPort.dir.x * curve;
                let c2y = tPort.y + tPort.dir.y * curve;
                
                const key = getEdgePortKey(edge);
                const siblings = state.edges.filter(e => getEdgePortKey(e) === key);
                if (siblings.length > 1) {
                    siblings.sort((a, b) => a.id.localeCompare(b.id));
                    const index = siblings.findIndex(e => e.id === edge.id);
                    const count = siblings.length;
                    
                    const step = 40;
                    const mid = (count - 1) / 2;
                    const offsetValue = (index - mid) * step;
                    
                    const nx = -dy / (dist || 1);
                    const ny = dx / (dist || 1);
                    
                    c1x += nx * offsetValue;
                    c1y += ny * offsetValue;
                    c2x += nx * offsetValue;
                    c2y += ny * offsetValue;
                }
                
                const mx = (e.clientX - uiState.canvasOffset.x) / uiState.zoom;
                const my = (e.clientY - uiState.canvasOffset.y) / uiState.zoom;
                
                let bestT = 0.5;
                let minDist = Infinity;
                
                const page = state.pages.find(p => p.id === uiState.activePageId);
                const defaultRouting = (page && page.settings && page.settings.routingMode) || 'bezier';
                const edgeRouting = edge.routingMode;
                const activeMode = (edgeRouting && edgeRouting !== 'default') ? edgeRouting : defaultRouting;

                for(let i = 0; i <= 20; i++) {
                    const t = i / 20;
                    let px, py;
                    if (activeMode === 'orthogonal') {
                        const pt = getPointOnOrthogonalPath(sPort, tPort, t, edge);
                        px = pt.x;
                        py = pt.y;
                    } else {
                        const mt = 1 - t;
                        const mt2 = mt * mt;
                        const mt3 = mt2 * mt;
                        const t2 = t * t;
                        const t3 = t2 * t;
                        px = mt3 * sPort.x + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t3 * tPort.x;
                        py = mt3 * sPort.y + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t3 * tPort.y;
                    }
                    
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
        if (uiState.isDrawing) {
            uiState.isDrawing = false;
            if (uiState.currentDrawingPath && uiState.currentDrawingPath.points.length > 1) {
                if (!state.drawings) state.drawings = [];
                state.drawings.push(uiState.currentDrawingPath);
                saveState();
            }
            uiState.currentDrawingPath = null;
            const tempPath = document.getElementById('temp-active-path');
            if (tempPath) tempPath.remove();
            renderAll();
        }
        if (uiState.isDraggingMinimap) {
            uiState.isDraggingMinimap = false;
            const vp = document.getElementById('minimap-viewport');
            if (vp) vp.classList.remove('dragging');
            saveState();
        }
        if (uiState.isDraggingRoutingHandle) {
            uiState.isDraggingRoutingHandle = false;
            uiState.draggedEdgeId = null;
            saveState();
        }
        if (uiState.isResizing) {
            document.body.classList.remove(`is-resizing-${uiState.resizeDirection}`);
            uiState.isResizing = false;
            uiState.resizeNodeId = null;
            uiState.resizeDirection = null;
            uiState.resizeStartData = null;
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

    workspace.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    workspace.addEventListener('drop', (e) => {
        e.preventDefault();
        try {
            const dataStr = e.dataTransfer.getData('application/json');
            if (!dataStr) return;
            const data = JSON.parse(dataStr);
            if (data.type === 'template') {
                const t = state.templates.find(temp => temp.id === data.id);
                if (t) {
                    const rect = workspace.getBoundingClientRect();
                    const dropX = (e.clientX - rect.left - uiState.canvasOffset.x) / uiState.zoom;
                    const dropY = (e.clientY - rect.top - uiState.canvasOffset.y) / uiState.zoom;
                    instantiateTemplate(t, dropX, dropY);
                }
            }
        } catch (err) {
            console.error("Failed to drop template:", err);
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
            document.getElementById('cm-save-template').style.display = 'none';
            
            const rect = workspace.getBoundingClientRect();
            canvasContextMenuLocation = {
                x: (e.clientX - rect.left - uiState.canvasOffset.x) / uiState.zoom - 90,
                y: (e.clientY - rect.top - uiState.canvasOffset.y) / uiState.zoom - 40
            };
            
            const scale = state.settings.hudScale || 1;
            contextMenu.style.display = 'flex';
            contextMenu.style.left = (e.clientX / scale) + 'px';
            contextMenu.style.top = (e.clientY / scale) + 'px';
        }
    });

    document.getElementById('ds-title').addEventListener('input', updateActiveNodeFromUI);
    
    // Markdown Edit/Preview Toggle
    const descEditBtn = document.getElementById('ds-desc-edit-btn');
    const descPreviewBtn = document.getElementById('ds-desc-preview-btn');
    const descTextarea = document.getElementById('ds-description');
    const descPreviewArea = document.getElementById('ds-description-preview');

    if (descEditBtn && descPreviewBtn && descTextarea && descPreviewArea) {
        descEditBtn.addEventListener('click', () => {
            descEditBtn.classList.add('active');
            descPreviewBtn.classList.remove('active');
            descTextarea.style.display = 'block';
            descPreviewArea.style.display = 'none';
        });

        descPreviewBtn.addEventListener('click', () => {
            descPreviewBtn.classList.add('active');
            descEditBtn.classList.remove('active');
            descTextarea.style.display = 'none';
            descPreviewArea.style.display = 'block';
            descPreviewArea.innerHTML = typeof marked !== 'undefined' ? marked.parse(descTextarea.value || '') : '<em>Markdown parser not loaded.</em>';
        });

        descTextarea.addEventListener('input', updateActiveNodeFromUI);
    } else {
        document.getElementById('ds-description').addEventListener('input', updateActiveNodeFromUI);
    }
    
    const dateInputHandler = (inputId) => {
        const el = document.getElementById(inputId);
        if (el) {
            el.oninput = () => { clampDateInputYear(el); updateActiveNodeFromUI(); };
            el.onchange = () => { clampDateInputYear(el); updateActiveNodeFromUI(); };
        }
    };
    dateInputHandler('ds-deadline-start');
    dateInputHandler('ds-deadline-end');
    
    const startTimeInput = document.getElementById('ds-deadline-start-time');
    const endTimeInput = document.getElementById('ds-deadline-end-time');
    if (startTimeInput) {
        startTimeInput.oninput = updateActiveNodeFromUI;
        startTimeInput.onchange = updateActiveNodeFromUI;
    }
    if (endTimeInput) {
        endTimeInput.oninput = updateActiveNodeFromUI;
        endTimeInput.onchange = updateActiveNodeFromUI;
    }

    // Bind Clear buttons for deadlines
    const startClearBtn = document.getElementById('ds-deadline-start-clear');
    if (startClearBtn) {
        startClearBtn.onclick = () => {
            const dateEl = document.getElementById('ds-deadline-start');
            const timeEl = document.getElementById('ds-deadline-start-time');
            if (dateEl) dateEl.value = '';
            if (timeEl) timeEl.value = '';
            updateActiveNodeFromUI();
        };
    }
    const endClearBtn = document.getElementById('ds-deadline-end-clear');
    if (endClearBtn) {
        endClearBtn.onclick = () => {
            const dateEl = document.getElementById('ds-deadline-end');
            const timeEl = document.getElementById('ds-deadline-end-time');
            if (dateEl) dateEl.value = '';
            if (timeEl) timeEl.value = '';
            updateActiveNodeFromUI();
        };
    }
    
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
    
    document.getElementById('es-edge-routing').addEventListener('change', (e) => {
        if (uiState.selectedEdgeId) {
            const edge = state.edges.find(ed => ed.id === uiState.selectedEdgeId);
            if (edge) { edge.routingMode = e.target.value; saveState(); renderAll(); }
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

    document.getElementById('ps-snap-resize-toggle').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) {
            page.settings.snapResizeToGrid = e.target.checked;
            saveState();
        }
    });

    document.getElementById('ps-edge-routing').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) {
            page.settings.routingMode = e.target.value;
            saveState();
            renderAll();
        }
    });

    document.getElementById('ps-override-deadlines').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) {
            page.settings.overrideDeadlineSettings = e.target.checked;
            document.getElementById('ps-deadline-override-opts').style.display = e.target.checked ? 'block' : 'none';
            saveState();
            renderAll();
        }
    });
    document.getElementById('ps-show-deadlines').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) { page.settings.showDeadlines = e.target.checked; saveState(); renderAll(); }
    });
    document.getElementById('ps-show-subtask-deadlines').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) { page.settings.showSubtaskDeadlines = e.target.checked; saveState(); renderAll(); }
    });
    document.getElementById('ps-show-time-remaining').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) { page.settings.showTimeRemaining = e.target.checked; saveState(); renderAll(); }
    });
    document.getElementById('ps-near-deadline-days').addEventListener('change', (e) => {
        const page = state.pages.find(p => p.id === uiState.activePageId);
        if (page) { page.settings.nearDeadlineDays = parseInt(e.target.value) || 0; saveState(); renderAll(); }
    });
    const psEmojiApply = document.getElementById('ps-deadline-emoji-apply');
    if (psEmojiApply) {
        psEmojiApply.addEventListener('click', () => {
            const page = state.pages.find(p => p.id === uiState.activePageId);
            const input = document.getElementById('ps-deadline-emoji');
            if (page && input) { page.settings.deadlineEmoji = input.value || '🕒'; saveState(); renderAll(); }
        });
    }

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
    document.getElementById('cm-save-template').addEventListener('click', () => {
        closeContextMenu();
        saveTemplateFromSelection();
    });

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

function startResize(e, id, dir) {
    e.stopPropagation();
    e.preventDefault();
    const node = state.nodes.find(n => n.id === id);
    if (!node) return;
    const el = document.getElementById(`node-${id}`);
    uiState.isResizing = true;
    uiState.resizeNodeId = id;
    uiState.resizeDirection = dir;
    uiState.resizeStartMouse = { x: e.clientX, y: e.clientY };
    uiState.resizeStartData = {
        x: node.x,
        y: node.y,
        width: el ? el.offsetWidth : (node.width || 180),
        height: el ? el.offsetHeight : (node.height || 80)
    };
    document.body.classList.add(`is-resizing-${dir}`);
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
    
    const scale = state.settings.hudScale || 1;
    contextMenu.style.display = 'flex';
    contextMenu.style.left = (e.clientX / scale) + 'px';
    contextMenu.style.top = (e.clientY / scale) + 'px';
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
    document.getElementById('cm-save-template').style.display = uiState.selectedNodeIds.size > 0 ? 'block' : 'none';
}

function showEdgeContextMenu(e, edgeId) {
    e.preventDefault();
    e.stopPropagation();
    uiState.selectedNodeIds.clear();
    uiState.selectedEdgeId = edgeId;
    renderAll();
    updateSidebarUI();
    
    document.getElementById('cm-add-task').style.display = 'none';
    document.getElementById('cm-add-info').style.display = 'none';
    document.getElementById('cm-add-container').style.display = 'none';
    document.getElementById('cm-group').style.display = 'none';
    document.getElementById('cm-ungroup').style.display = 'none';
    document.getElementById('cm-copy').style.display = 'none';
    document.getElementById('cm-paste').style.display = 'none';
    document.getElementById('cm-save-template').style.display = 'none';
    document.getElementById('cm-delete').style.display = 'block';
    
    const scale = state.settings.hudScale || 1;
    contextMenu.style.display = 'flex';
    contextMenu.style.left = (e.clientX / scale) + 'px';
    contextMenu.style.top = (e.clientY / scale) + 'px';
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
            document.getElementById('es-edge-routing').value = edge.routingMode || 'default';
            
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
            
            // Reset to Edit mode
            if (document.getElementById('ds-desc-edit-btn')) {
                document.getElementById('ds-desc-edit-btn').click();
            }
            document.getElementById('ds-title').setAttribute('contenteditable', 'true');
            
            document.getElementById('ds-deadline-start').value = node.deadlineStart || '';
            document.getElementById('ds-deadline-end').value = node.deadlineEnd || '';
            document.getElementById('ds-deadline-start-time').value = node.deadlineStartTime || '';
            document.getElementById('ds-deadline-end-time').value = node.deadlineEndTime || '';
            
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
            document.getElementById('ps-snap-resize-toggle').checked = activePage.settings.snapResizeToGrid || false;
            document.getElementById('ps-edge-routing').value = activePage.settings.routingMode || 'bezier';
            
            const psOverride = document.getElementById('ps-override-deadlines');
            const psOpts = document.getElementById('ps-deadline-override-opts');
            if (psOverride && psOpts) {
                psOverride.checked = !!activePage.settings.overrideDeadlineSettings;
                psOpts.style.display = activePage.settings.overrideDeadlineSettings ? 'block' : 'none';
                document.getElementById('ps-show-deadlines').checked = activePage.settings.showDeadlines !== false;
                document.getElementById('ps-show-subtask-deadlines').checked = activePage.settings.showSubtaskDeadlines !== false;
                document.getElementById('ps-show-time-remaining').checked = activePage.settings.showTimeRemaining === true;
                document.getElementById('ps-near-deadline-days').value = activePage.settings.nearDeadlineDays !== undefined ? activePage.settings.nearDeadlineDays : 3;
                const psEmojiInput = document.getElementById('ps-deadline-emoji');
                if (psEmojiInput) psEmojiInput.value = activePage.settings.deadlineEmoji || '🕒';
            }
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
        node.deadlineStart = document.getElementById('ds-deadline-start').value;
        node.deadlineEnd = document.getElementById('ds-deadline-end').value;
        node.deadlineStartTime = document.getElementById('ds-deadline-start-time').value;
        node.deadlineEndTime = document.getElementById('ds-deadline-end-time').value;
        
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
            updateMinimapVisibility();
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
            updateMinimapVisibility();
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
// Sidebar Resize Logic
// ==========================================
function setupSidebarResizers() {
    // Helper: make an element act as a drag resizer
    function makeResizer(resizerEl, targetEl, side, minW, maxW) {
        let startX, startW;
        resizerEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startW = targetEl.offsetWidth;
            document.body.style.cursor = 'ew-resize';
            document.body.classList.add('is-resizing-sidebar');
            resizerEl.classList.add('resizing');

            function onMove(ev) {
                let delta = side === 'right' ? ev.clientX - startX : startX - ev.clientX;
                let newW = Math.min(maxW, Math.max(minW, startW + delta));
                targetEl.style.width = newW + 'px';
                // Update zoom controls left offset to match sidebar
                if (targetEl.id === 'sidebar') {
                    const zc = document.getElementById('zoom-controls');
                    if (zc) zc.style.left = (newW + 40) + 'px';
                }
            }
            function onUp() {
                document.body.style.cursor = '';
                document.body.classList.remove('is-resizing-sidebar');
                resizerEl.classList.remove('resizing');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Left sidebar — drag right edge to resize width
    const leftSidebar = document.getElementById('sidebar');
    if (leftSidebar && !leftSidebar.querySelector('.sidebar-resizer-right')) {
        const rEl = document.createElement('div');
        rEl.className = 'sidebar-resizer-right';
        leftSidebar.appendChild(rEl);
        makeResizer(rEl, leftSidebar, 'right', 180, 480);
    }

    // Right sidebar — drag left edge to resize width
    const rightSidebar = document.getElementById('details-sidebar');
    if (rightSidebar && !rightSidebar.querySelector('.sidebar-resizer-left')) {
        const rEl = document.createElement('div');
        rEl.className = 'sidebar-resizer-left';
        rightSidebar.appendChild(rEl);
        makeResizer(rEl, rightSidebar, 'left', 260, 560);
    }

    // Left sidebar pages/templates divider
    const pagesList = document.getElementById('pages-list');
    if (pagesList && !pagesList.nextElementSibling?.classList.contains('section-resizer')) {
        const divider = document.createElement('div');
        divider.className = 'section-resizer';
        divider.title = 'Drag to resize sections';
        pagesList.parentNode.insertBefore(divider, pagesList.nextElementSibling);

        let startY, startH;
        divider.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startH = pagesList.offsetHeight;
            document.body.classList.add('is-resizing-sidebar');
            divider.classList.add('resizing');
            function onMove(ev) {
                let delta = ev.clientY - startY;
                let newH = Math.max(60, Math.min(startH + delta, leftSidebar.offsetHeight - 200));
                pagesList.style.height = newH + 'px';
            }
            function onUp() {
                document.body.classList.remove('is-resizing-sidebar');
                divider.classList.remove('resizing');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
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

    // Type to Edit Title Settings Toggle
    const stTypeToEditBtn = document.getElementById('st-type-to-edit');
    if (stTypeToEditBtn) {
        stTypeToEditBtn.checked = state.settings.typeToEditTitle !== false;
        stTypeToEditBtn.addEventListener('change', (e) => {
            state.settings.typeToEditTitle = e.target.checked;
            saveState();
        });
    }

    const stShowDeadlines = document.getElementById('st-show-deadlines');
    if (stShowDeadlines) {
        stShowDeadlines.checked = state.settings.showDeadlines !== false;
        stShowDeadlines.addEventListener('change', (e) => {
            state.settings.showDeadlines = e.target.checked;
            saveState();
            renderAll();
        });
    }
    const stShowSubtaskDeadlines = document.getElementById('st-show-subtask-deadlines');
    if (stShowSubtaskDeadlines) {
        stShowSubtaskDeadlines.checked = state.settings.showSubtaskDeadlines !== false;
        stShowSubtaskDeadlines.addEventListener('change', (e) => {
            state.settings.showSubtaskDeadlines = e.target.checked;
            saveState();
            renderAll();
        });
    }
    const stNearDeadlineDays = document.getElementById('st-near-deadline-days');
    if (stNearDeadlineDays) {
        stNearDeadlineDays.value = state.settings.nearDeadlineDays !== undefined ? state.settings.nearDeadlineDays : 3;
        stNearDeadlineDays.addEventListener('change', (e) => {
            state.settings.nearDeadlineDays = parseInt(e.target.value) || 0;
            saveState();
            renderAll();
        });
    }
    const stDeadlineEmojiApply = document.getElementById('st-deadline-emoji-apply');
    if (stDeadlineEmojiApply) {
        stDeadlineEmojiApply.addEventListener('click', () => {
            const input = document.getElementById('st-deadline-emoji');
            if (input) { state.settings.deadlineEmoji = input.value || '🕒'; saveState(); renderAll(); }
        });
    }
    const stShowTimeRemaining = document.getElementById('st-show-time-remaining');
    if (stShowTimeRemaining) {
        stShowTimeRemaining.checked = state.settings.showTimeRemaining === true;
        stShowTimeRemaining.addEventListener('change', (e) => {
            state.settings.showTimeRemaining = e.target.checked;
            saveState();
            renderAll();
        });
    }

    // HUD Size Controls
    const hudSizeLabel = document.getElementById('hud-size-label');
    const hudResetBtn = document.getElementById('hud-reset');
    const hudDecreaseBtn = document.getElementById('hud-decrease');
    const hudIncreaseBtn = document.getElementById('hud-increase');

    function updateHudSizeLabel() {
        const pct = Math.round((state.settings.hudScale || 1) * 100) + '%';
        if (hudSizeLabel) hudSizeLabel.textContent = pct;
    }

    if (hudDecreaseBtn) {
        hudDecreaseBtn.addEventListener('click', () => {
            const current = state.settings.hudScale || 1;
            state.settings.hudScale = Math.max(0.5, Math.round((current - 0.1) * 100) / 100);
            saveState();
            applyHudScale();
            updateHudSizeLabel();
        });
    }

    if (hudIncreaseBtn) {
        hudIncreaseBtn.addEventListener('click', () => {
            const current = state.settings.hudScale || 1;
            state.settings.hudScale = Math.min(2, Math.round((current + 0.1) * 100) / 100);
            saveState();
            applyHudScale();
            updateHudSizeLabel();
        });
    }

    if (hudResetBtn) {
        hudResetBtn.addEventListener('click', () => {
            state.settings.hudScale = 1;
            saveState();
            applyHudScale();
            updateHudSizeLabel();
        });
    }

    // Minimap Size Controls
    const msSizeLabel = document.getElementById('ms-size-label');
    const msResetBtn = document.getElementById('ms-reset');
    const msDecreaseBtn = document.getElementById('ms-decrease');
    const msIncreaseBtn = document.getElementById('ms-increase');

    function updateMinimapSizeLabel() {
        const pct = Math.round((state.settings.minimapScale || 1) * 100) + '%';
        if (msSizeLabel) msSizeLabel.textContent = pct;
    }

    if (msDecreaseBtn) {
        msDecreaseBtn.addEventListener('click', () => {
            const current = state.settings.minimapScale || 1;
            state.settings.minimapScale = Math.max(0.5, Math.round((current - 0.25) * 100) / 100);
            saveState();
            applyMinimapScale();
            updateMinimapSizeLabel();
        });
    }

    if (msIncreaseBtn) {
        msIncreaseBtn.addEventListener('click', () => {
            const current = state.settings.minimapScale || 1;
            state.settings.minimapScale = Math.min(3, Math.round((current + 0.25) * 100) / 100);
            saveState();
            applyMinimapScale();
            updateMinimapSizeLabel();
        });
    }

    if (msResetBtn) {
        msResetBtn.addEventListener('click', () => {
            state.settings.minimapScale = 1;
            saveState();
            applyMinimapScale();
            updateMinimapSizeLabel();
        });
    }

    // Refresh label when modal opens
    settingsToggle.addEventListener('click', () => {
        updateHudSizeLabel();
        updateMinimapSizeLabel();
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

// init() moved to bottom of file
// --- CUSTOM TEMPLATES FUNCTIONALITY ---

function getDescendantNodeIds(nodeIds) {
    let descendants = new Set(nodeIds);
    let queue = [...nodeIds];
    while (queue.length > 0) {
        const currentId = queue.shift();
        const children = state.nodes.filter(n => n.parentId === currentId);
        children.forEach(child => {
            if (!descendants.has(child.id)) {
                descendants.add(child.id);
                queue.push(child.id);
            }
        });
    }
    return Array.from(descendants);
}

function saveTemplateFromSelection() {
    const selectedIds = Array.from(uiState.selectedNodeIds);
    if (selectedIds.length === 0) return;

    // Recursively resolve all nested descendant bubbles!
    const allIdsToSave = getDescendantNodeIds(selectedIds);

    openCustomDialog({
        title: "Save as Template",
        message: "Enter a name for this template:",
        showInput: true,
        defaultValue: "New Template",
        confirmText: "Save",
        onConfirm: (templateName) => {
            if (!templateName || templateName.trim() === '') return;
            
            const nodesToSave = state.nodes.filter(n => allIdsToSave.includes(n.id));
            const edgesToSave = state.edges.filter(e => allIdsToSave.includes(e.source) && allIdsToSave.includes(e.target));
            
            if (nodesToSave.length === 0) return;

            // Calculate bounding box to normalize coordinates
            let minX = Infinity, minY = Infinity;
            nodesToSave.forEach(n => {
                if (n.x < minX) minX = n.x;
                if (n.y < minY) minY = n.y;
            });

            // Deep clone and normalize
            const templateNodes = JSON.parse(JSON.stringify(nodesToSave));
            templateNodes.forEach(n => {
                n.x -= minX;
                n.y -= minY;
                if (n.parentId && !allIdsToSave.includes(n.parentId)) {
                    n.parentId = null;
                }
            });

            const templateEdges = JSON.parse(JSON.stringify(edgesToSave));

            const newTemplate = {
                id: generateId(),
                title: templateName,
                nodes: templateNodes,
                edges: templateEdges
            };

            state.templates.push(newTemplate);
            saveState();
            renderTemplatesList();
            showToast(`Template "${templateName}" saved successfully!`, 'success');
        }
    });
}

function renderTemplatesList() {
    const list = document.getElementById('templates-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (state.templates.length === 0) {
        list.innerHTML = `<div style="font-size: 12px; color: var(--color-text-muted); text-align: center; padding: 12px;">No templates saved. Select bubbles and right-click to save!</div>`;
        return;
    }

    state.templates.forEach(t => {
        const item = document.createElement('div');
        item.className = 'page-item';
        item.style.cursor = 'grab';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '8px 12px';
        item.style.borderRadius = '8px';
        item.style.background = 'rgba(255, 255, 255, 0.05)';
        item.style.border = '1px solid var(--color-surface-border)';
        item.draggable = true;
        
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/json', JSON.stringify({ type: 'template', id: t.id }));
            item.style.opacity = '0.5';
        });

        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
        });
        
        item.addEventListener('click', () => {
            const dropX = (window.innerWidth / 2 - uiState.canvasOffset.x) / uiState.zoom;
            const dropY = (window.innerHeight / 2 - uiState.canvasOffset.y) / uiState.zoom;
            instantiateTemplate(t, dropX - 100, dropY - 100);
        });

        const titleSpan = document.createElement('span');
        titleSpan.innerText = t.title;
        titleSpan.style.flexGrow = '1';
        titleSpan.style.overflow = 'hidden';
        titleSpan.style.textOverflow = 'ellipsis';
        titleSpan.style.whiteSpace = 'nowrap';
        item.appendChild(titleSpan);

        const delBtn = document.createElement('button');
        delBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;
        delBtn.className = 'icon-btn';
        delBtn.style.padding = '4px';
        delBtn.style.marginLeft = '8px';
        delBtn.style.border = 'none';
        delBtn.style.background = 'none';
        delBtn.style.color = 'var(--color-danger)';
        delBtn.style.cursor = 'pointer';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            openCustomDialog({
                title: "Delete Template",
                message: `Are you sure you want to delete the template "${t.title}"?`,
                showInput: false,
                confirmText: "Delete",
                onConfirm: () => {
                    const oldTitle = t.title;
                    state.templates = state.templates.filter(temp => temp.id !== t.id);
                    saveState();
                    renderTemplatesList();
                    showToast(`Template "${oldTitle}" deleted successfully.`, 'danger');
                }
            });
        };
        item.appendChild(delBtn);

        list.appendChild(item);
    });
}

function instantiateTemplate(template, dropX, dropY) {
    uiState.selectedNodeIds.clear();
    const idMap = {};
    
    template.nodes.forEach(n => {
        const newId = generateId();
        idMap[n.id] = newId;
        const clonedNode = JSON.parse(JSON.stringify(n));
        clonedNode.id = newId;
        clonedNode.x = dropX + n.x;
        clonedNode.y = dropY + n.y;
        clonedNode.pageId = uiState.activePageId;
        if (clonedNode.parentId && idMap[clonedNode.parentId]) {
            clonedNode.parentId = idMap[clonedNode.parentId];
        } else {
            clonedNode.parentId = uiState.currentCanvasId;
        }
        state.nodes.push(clonedNode);
        uiState.selectedNodeIds.add(newId);
    });

    template.edges.forEach(e => {
        const clonedEdge = JSON.parse(JSON.stringify(e));
        clonedEdge.id = generateId();
        if (idMap[e.source] && idMap[e.target]) {
            clonedEdge.source = idMap[e.source];
            clonedEdge.target = idMap[e.target];
            state.edges.push(clonedEdge);
        }
    });

    saveState();
    renderAll();
    updateSidebarUI();
}

// --- Sleek Custom Dialog & Toast System ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    
    let iconSVG = '';
    if (type === 'success') {
        iconSVG = `<svg class="toast-icon success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'danger') {
        iconSVG = `<svg class="toast-icon danger" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    } else {
        iconSVG = `<svg class="toast-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
    
    toast.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
            ${iconSVG}
            <span>${message}</span>
        </div>
    `;
    
    container.appendChild(toast);
    
    // Force reflow
    toast.offsetHeight;
    
    // Slide in
    toast.classList.add('show');
    
    // Auto remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

function openCustomDialog({ title, message, showInput = true, defaultValue = '', placeholder = '', confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onCancel }) {
    const dialog = document.getElementById('custom-dialog');
    const backdrop = document.getElementById('custom-dialog-backdrop');
    const titleEl = document.getElementById('custom-dialog-title');
    const messageEl = document.getElementById('custom-dialog-message');
    const inputEl = document.getElementById('custom-dialog-input');
    const confirmBtn = document.getElementById('custom-dialog-confirm');
    const cancelBtn = document.getElementById('custom-dialog-cancel');
    
    titleEl.innerText = title;
    messageEl.innerText = message;
    
    if (showInput) {
        inputEl.style.display = 'block';
        inputEl.value = defaultValue;
        inputEl.placeholder = placeholder;
    } else {
        inputEl.style.display = 'none';
    }
    
    confirmBtn.innerText = confirmText;
    cancelBtn.innerText = cancelText;
    
    dialog.style.display = 'flex';
    backdrop.style.display = 'block';
    
    if (showInput) {
        setTimeout(() => inputEl.focus(), 50);
    }
    
    const cleanup = () => {
        dialog.style.display = 'none';
        backdrop.style.display = 'none';
        
        // Remove event listeners by cloning nodes
        const newConfirm = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        const newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    };
    
    document.getElementById('custom-dialog-confirm').addEventListener('click', () => {
        const val = showInput ? inputEl.value : true;
        cleanup();
        if (onConfirm) onConfirm(val);
    });
    
    document.getElementById('custom-dialog-cancel').addEventListener('click', () => {
        cleanup();
        if (onCancel) onCancel();
    });
    
    // Close on escape or enter
    const handleKey = (e) => {
        if (e.key === 'Enter') {
            document.getElementById('custom-dialog-confirm').click();
            window.removeEventListener('keydown', handleKey);
        } else if (e.key === 'Escape') {
            document.getElementById('custom-dialog-cancel').click();
            window.removeEventListener('keydown', handleKey);
        }
    };
    window.addEventListener('keydown', handleKey);
}

// Refresh time remaining every minute
setInterval(() => {
    if (state.settings.showTimeRemaining || (state.pages && state.pages.some(p => p.settings && p.settings.showTimeRemaining))) {
        renderAll();
    }
}, 60000);

// --- COLLABORATION WITH YJS & WEBRTC ---
let ydoc = null;
let yprovider = null;
let yNodesMap = null;
let yEdgesMap = null;
let yPagesMap = null;
let yDrawingsMap = null;
let yThemeMap = null;
let ySettingsMap = null;
let localUser = {
    name: 'Wizard ' + Math.floor(Math.random() * 1000),
    color: ['gold', 'blue', 'green', 'purple', 'slate'][Math.floor(Math.random() * 5)]
};
let isApplyingRemoteUpdate = false;

async function initCollaboration() {
    setupCollabDOM();
    
    // Check if room is present in URL
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    if (room) {
        startCollaboration(room);
    }
}

function setupCollabDOM() {
    const btnCollab = document.getElementById('btn-collaborate');
    const modalCollab = document.getElementById('collab-modal');
    const closeCollab = document.getElementById('close-collab');
    const collabBackdrop = document.getElementById('collab-backdrop');
    
    const startSection = document.getElementById('collab-start-section');
    const activeSection = document.getElementById('collab-active-section');
    
    const btnStart = document.getElementById('collab-btn-start');
    const btnStop = document.getElementById('collab-btn-stop');
    const btnCopy = document.getElementById('collab-btn-copy');
    const shareLink = document.getElementById('collab-share-link');
    
    btnCollab.addEventListener('click', () => {
        modalCollab.style.display = 'flex';
        collabBackdrop.style.display = 'block';
        updateCollabUI();
    });
    
    const hideModal = () => {
        modalCollab.style.display = 'none';
        collabBackdrop.style.display = 'none';
    };
    closeCollab.addEventListener('click', hideModal);
    collabBackdrop.addEventListener('click', hideModal);
    
    btnStart.addEventListener('click', () => {
        const roomId = 'room-' + generateId();
        const signalingInput = document.getElementById('collab-signaling-url');
        const customUrl = signalingInput && signalingInput.value.trim();
        startCollaboration(roomId, customUrl || null);
        updateCollabUI();
    });
    
    btnStop.addEventListener('click', () => {
        stopCollaboration();
        updateCollabUI();
    });
    
    btnCopy.addEventListener('click', () => {
        shareLink.select();
        document.execCommand('copy');
        showToast('Link copied to clipboard!', 'success');
    });
}

function updateCollabUI() {
    const btnCollab = document.getElementById('btn-collaborate');
    const startSection = document.getElementById('collab-start-section');
    const activeSection = document.getElementById('collab-active-section');
    const shareLink = document.getElementById('collab-share-link');
    
    if (yprovider) {
        btnCollab.classList.add('collab-active');
        startSection.style.display = 'none';
        activeSection.style.display = 'block';
        const url = new URL(window.location.href);
        // Ensure the share link has the correct room ID even if pushState failed
        if (yprovider && yprovider.roomName) {
            url.searchParams.set('room', yprovider.roomName);
        }
        shareLink.value = url.toString();
    } else {
        btnCollab.classList.remove('collab-active');
        startSection.style.display = 'block';
        activeSection.style.display = 'none';
        shareLink.value = '';
    }
}

async function startCollaboration(roomId, customSignalingUrl) {
    if (yprovider) return;
    
    showToast('Connecting to room...', 'info');
    
    // Update URL if needed
    const url = new URL(window.location.href);
    if (url.searchParams.get('room') !== roomId) {
        url.searchParams.set('room', roomId);
        try {
            window.history.pushState({}, '', url);
        } catch (e) {
            console.warn('Could not update URL history (running locally via file://)');
        }
    }
    
    try {
        // Dynamically import Yjs & WebRTC
        const Y = await import('https://esm.sh/yjs@13.6.15');
        const { WebrtcProvider } = await import('https://esm.sh/y-webrtc@10.3.0?deps=yjs@13.6.15');
        
        ydoc = new Y.Doc();
        const signalingServers = customSignalingUrl
            ? [customSignalingUrl]
            : ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com'];

        yprovider = new WebrtcProvider(roomId, ydoc, {
            signaling: signalingServers
        });
        
        yNodesMap = ydoc.getMap('nodes');
        yEdgesMap = ydoc.getMap('edges');
        yPagesMap = ydoc.getMap('pages');
        yDrawingsMap = ydoc.getMap('drawings');
        yThemeMap = ydoc.getMap('theme');
        ySettingsMap = ydoc.getMap('settings');
        
        // If we have local state, load it into Yjs if Yjs is empty
        if (yPagesMap.size === 0 && state.pages.length > 0) {
            state.pages.forEach(p => yPagesMap.set(p.id, p));
            state.nodes.forEach(n => yNodesMap.set(n.id, n));
            state.edges.forEach(e => yEdgesMap.set(e.id, e));
            if (state.drawings) state.drawings.forEach(d => yDrawingsMap.set(d.id, d));
            yThemeMap.set('theme', state.theme);
            ySettingsMap.set('settings', state.settings);
        } else {
            // Load from Yjs to local state
            syncStateFromYjs();
        }
        
        // Set up observers
        const handleYjsChange = () => {
            if (isApplyingRemoteUpdate) return;
            isApplyingRemoteUpdate = true;
            syncStateFromYjs();
            renderAll();
            updateSidebarUI();
            renderPagesList();
            renderBreadcrumbs();
            isApplyingRemoteUpdate = false;
        };
        
        yNodesMap.observe(handleYjsChange);
        yEdgesMap.observe(handleYjsChange);
        yPagesMap.observe(handleYjsChange);
        yDrawingsMap.observe(handleYjsChange);
        yThemeMap.observe(handleYjsChange);
        ySettingsMap.observe(handleYjsChange);
        
        // Setup Awareness (Live Cursors)
        const awareness = yprovider.awareness;
        awareness.setLocalStateField('user', {
            name: localUser.name,
            color: getCssColorForName(localUser.color)
        });
        
        // Add mouse move listener to broadcast cursor
        workspace.addEventListener('mousemove', (e) => {
            if (!yprovider) return;
            const rect = workspace.getBoundingClientRect();
            const x = (e.clientX - rect.left - uiState.canvasOffset.x) / uiState.zoom;
            const y = (e.clientY - rect.top - uiState.canvasOffset.y) / uiState.zoom;
            
            awareness.setLocalStateField('cursor', {
                x, y,
                activePageId: uiState.activePageId,
                currentCanvasId: uiState.currentCanvasId
            });
        });
        
        // Listen to remote cursors
        awareness.on('change', () => {
            renderLiveCursors(awareness.getStates());
            renderParticipantsList(awareness.getStates());
        });
        
        showToast('Connected to collaboration session!', 'success');
        updateCollabUI();
        renderAll();
    } catch (e) {
        console.error("Collaboration failed to connect", e);
        if (window.location.protocol === 'file:') {
            showToast('Collaboration requires a local web server (or GitHub Pages) due to browser security blocking file:// modules.', 'danger');
        } else {
            showToast('Failed to connect to collaboration room.', 'danger');
        }
    }
}

function stopCollaboration() {
    if (!yprovider) return;
    
    yprovider.destroy();
    ydoc.destroy();
    yprovider = null;
    ydoc = null;
    
    // Clear URL parameter
    try {
        const url = new URL(window.location.href);
        url.searchParams.delete('room');
        window.history.pushState({}, '', url);
    } catch(e) {}
    
    // Clear cursor layer
    document.getElementById('cursors-container').innerHTML = '';
    
    showToast('Collaboration session stopped.', 'danger');
}

function syncStateFromYjs() {
    state.nodes = Array.from(yNodesMap.values());
    state.edges = Array.from(yEdgesMap.values());
    state.pages = Array.from(yPagesMap.values());
    state.drawings = Array.from(yDrawingsMap.values());
    if (yThemeMap.has('theme')) state.theme = yThemeMap.get('theme');
    if (ySettingsMap.has('settings')) state.settings = ySettingsMap.get('settings');
    
    // Save to localstorage as backup
    localStorage.setItem('grimoire_state_v3', JSON.stringify(state));
}

function syncStateToYjs() {
    if (!yprovider || isApplyingRemoteUpdate) return;
    
    // Batch set nodes
    const localNodeIds = state.nodes.map(n => n.id);
    for (const key of yNodesMap.keys()) {
        if (!localNodeIds.includes(key)) yNodesMap.delete(key);
    }
    state.nodes.forEach(n => {
        const yNode = yNodesMap.get(n.id);
        if (JSON.stringify(yNode) !== JSON.stringify(n)) {
            yNodesMap.set(n.id, n);
        }
    });
    
    // Batch set edges
    const localEdgeIds = state.edges.map(e => e.id);
    for (const key of yEdgesMap.keys()) {
        if (!localEdgeIds.includes(key)) yEdgesMap.delete(key);
    }
    state.edges.forEach(e => {
        const yEdge = yEdgesMap.get(e.id);
        if (JSON.stringify(yEdge) !== JSON.stringify(e)) {
            yEdgesMap.set(e.id, e);
        }
    });

    // Batch set pages
    const localPageIds = state.pages.map(p => p.id);
    for (const key of yPagesMap.keys()) {
        if (!localPageIds.includes(key)) yPagesMap.delete(key);
    }
    state.pages.forEach(p => {
        const yPage = yPagesMap.get(p.id);
        if (JSON.stringify(yPage) !== JSON.stringify(p)) {
            yPagesMap.set(p.id, p);
        }
    });
    
    // Batch set drawings
    if (state.drawings) {
        const localDrawingIds = state.drawings.map(d => d.id);
        for (const key of yDrawingsMap.keys()) {
            if (!localDrawingIds.includes(key)) yDrawingsMap.delete(key);
        }
        state.drawings.forEach(d => {
            const yDrawing = yDrawingsMap.get(d.id);
            if (JSON.stringify(yDrawing) !== JSON.stringify(d)) {
                yDrawingsMap.set(d.id, d);
            }
        });
    }
    
    yThemeMap.set('theme', state.theme);
    ySettingsMap.set('settings', state.settings);
}

function getCssColorForName(colorName) {
    const colors = {
        gold: '#D4AF37',
        blue: '#82A0BC',
        green: '#9BB4A9',
        purple: '#A594B0',
        slate: '#8E98A0'
    };
    return colors[colorName] || '#D4AF37';
}

function renderLiveCursors(clientStates) {
    const container = document.getElementById('cursors-container');
    if (!container) return;
    container.innerHTML = '';
    
    const myClientId = yprovider.awareness.clientID;
    
    clientStates.forEach((clientState, clientId) => {
        if (clientId === myClientId) return;
        
        const cursor = clientState.cursor;
        const user = clientState.user;
        
        if (!cursor || !user) return;
        
        if (cursor.activePageId === uiState.activePageId && cursor.currentCanvasId === uiState.currentCanvasId) {
            const cursorEl = document.createElement('div');
            cursorEl.className = 'live-cursor';
            cursorEl.style.left = cursor.x + 'px';
            cursorEl.style.top = cursor.y + 'px';
            
            cursorEl.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M4.5 3V17L9.5 12L15.5 18L18 15.5L12 9.5L17 4.5H4.5Z" fill="${user.color}" stroke="#fff" stroke-width="1.5"/>
                </svg>
                <div class="live-cursor-label" style="background: ${user.color};">${user.name}</div>
            `;
            container.appendChild(cursorEl);
        }
    });
}

function renderParticipantsList(clientStates) {
    const list = document.getElementById('collab-participants');
    if (!list) return;
    list.innerHTML = '';
    
    clientStates.forEach((clientState, clientId) => {
        const user = clientState.user;
        if (!user) return;
        
        const item = document.createElement('div');
        item.className = 'participant-item';
        item.innerHTML = `
            <div class="participant-dot" style="background: ${user.color};"></div>
            <span>${user.name} ${clientId === yprovider.awareness.clientID ? ' (You)' : ''}</span>
        `;
        list.appendChild(item);
    });
}

// --- FREEHAND DRAWING AND ERASING ---
function initDrawing() {
    uiState.drawingMode = 'select'; // select, draw, erase
    uiState.isDrawing = false;
    uiState.currentDrawingPath = null;
    uiState.drawingColor = 'gold';
    uiState.drawingStrokeWidth = 4;
    uiState.drawingToolbarCollapsed = true;
    
    const toolbar = document.getElementById('drawing-toolbar');
    const toggleBtn = document.getElementById('drawing-toolbar-toggle');
    
    const btnSelect = document.getElementById('dt-select');
    const btnDraw = document.getElementById('dt-draw');
    const btnErase = document.getElementById('dt-erase');
    
    const colorBtns = document.querySelectorAll('.drawing-color-btn');
    const sliderStroke = document.getElementById('dt-stroke-width');
    
    toggleBtn.addEventListener('click', () => {
        uiState.drawingToolbarCollapsed = !uiState.drawingToolbarCollapsed;
        toggleBtn.classList.toggle('active', !uiState.drawingToolbarCollapsed);
        toolbar.classList.toggle('collapsed', uiState.drawingToolbarCollapsed);
        
        if (uiState.drawingToolbarCollapsed) {
            setDrawingMode('select');
        }
    });
    
    btnSelect.addEventListener('click', () => setDrawingMode('select'));
    btnDraw.addEventListener('click', () => setDrawingMode('draw'));
    btnErase.addEventListener('click', () => setDrawingMode('erase'));
    
    function setDrawingMode(mode) {
        uiState.drawingMode = mode;
        
        btnSelect.classList.toggle('active', mode === 'select');
        btnDraw.classList.toggle('active', mode === 'draw');
        btnErase.classList.toggle('active', mode === 'erase');
        
        if (mode === 'draw') {
            workspace.style.cursor = 'crosshair';
        } else if (mode === 'erase') {
            workspace.style.cursor = 'cell';
        } else {
            workspace.style.cursor = '';
        }
        
        renderDrawings();
    }
    
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            uiState.drawingColor = btn.dataset.color;
        });
    });
    
    sliderStroke.addEventListener('input', (e) => {
        uiState.drawingStrokeWidth = parseInt(e.target.value);
    });
}

function renderDrawings() {
    const drawingsGroup = document.getElementById('drawings-group');
    if (!drawingsGroup) return;
    drawingsGroup.innerHTML = '';
    
    if (!state.drawings) state.drawings = [];
    
    const visibleDrawings = state.drawings.filter(d => d.pageId === uiState.activePageId && d.canvasId === uiState.currentCanvasId);
    
    visibleDrawings.forEach(drawing => {
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('id', `drawing-${drawing.id}`);
        pathEl.setAttribute('d', pointsToSVGPath(drawing.points));
        pathEl.setAttribute('class', 'freehand-path' + (uiState.drawingMode === 'erase' ? ' erasable' : ''));
        const colorVar = getCssColorForName(drawing.color);
        pathEl.setAttribute('stroke', colorVar);
        pathEl.setAttribute('stroke-width', drawing.strokeWidth);
        pathEl.style.setProperty('--stroke-width', drawing.strokeWidth + 'px');
        
        pathEl.addEventListener('click', (e) => {
            if (uiState.drawingMode === 'erase') {
                e.stopPropagation();
                deleteDrawing(drawing.id);
            }
        });
        
        pathEl.addEventListener('mouseenter', (e) => {
            if (uiState.drawingMode === 'erase' && e.buttons === 1) {
                e.stopPropagation();
                deleteDrawing(drawing.id);
            }
        });
        
        drawingsGroup.appendChild(pathEl);
    });
}

function deleteDrawing(id) {
    state.drawings = state.drawings.filter(d => d.id !== id);
    saveState();
    renderAll();
}

function renderActiveDrawingPath() {
    const drawingsGroup = document.getElementById('drawings-group');
    if (!drawingsGroup || !uiState.currentDrawingPath) return;
    
    let pathEl = document.getElementById('temp-active-path');
    if (!pathEl) {
        pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.id = 'temp-active-path';
        drawingsGroup.appendChild(pathEl);
    }
    
    const colorVar = getCssColorForName(uiState.currentDrawingPath.color);
    pathEl.setAttribute('class', 'freehand-path');
    pathEl.setAttribute('stroke', colorVar);
    pathEl.setAttribute('stroke-width', uiState.currentDrawingPath.strokeWidth);
    pathEl.style.setProperty('--stroke-width', uiState.currentDrawingPath.strokeWidth + 'px');
    
    const dStr = pointsToSVGPath(uiState.currentDrawingPath.points);
    pathEl.setAttribute('d', dStr);
}

function pointsToSVGPath(points) {
    if (!points || points.length === 0) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
}

// Start application
setupSettings();
init();
