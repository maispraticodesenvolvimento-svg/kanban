// ========================================
// KANBAN BOARD PRO - JAVASCRIPT
// Sistema de gerenciamento de tarefas com Firebase
// ========================================

// Configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAdqArSTUD-nbUnvlHwXvwnGXesm0o0KNI",
    authDomain: "solpol.firebaseapp.com",
    databaseURL: "https://solpol-default-rtdb.firebaseio.com",
    projectId: "solpol",
    storageBucket: "solpol.firebasestorage.app",
    messagingSenderId: "79095824492",
    appId: "1:79095824492:web:1c171cbe221f58e3255849",
    measurementId: "G-420GF22W69"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const kanbanRef = database.ref('kanban');

// Estado da aplicação
const state = {
    tasks: {
        todo: [],
        progress: [],
        done: []
    },
    currentColumn: null,
    editingTask: null
};

// Elementos DOM
const modal = document.getElementById('taskModal');
const taskForm = document.getElementById('taskForm');
const taskTitleInput = document.getElementById('taskTitle');
const taskDescriptionInput = document.getElementById('taskDescription');
const taskPriorityInput = document.getElementById('taskPriority');
const cancelBtn = document.getElementById('cancelBtn');
const modalTitle = document.getElementById('modalTitle');

// ========================================
// INICIALIZAÇÃO
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupFirebaseListeners();
});

// ========================================
// EVENT LISTENERS
// ========================================

function setupEventListeners() {
    // Botões de adicionar tarefa
    document.querySelectorAll('.add-task-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.currentColumn = btn.dataset.column;
            state.editingTask = null;
            openModal();
        });
    });

    // Modal
    taskForm.addEventListener('submit', handleTaskSubmit);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Drag and Drop nas listas (Delegation seria melhor, mas mantendo compatibilidade)
    // Nota: Os eventos de drag nos cards são adicionados em createTaskCard
    document.querySelectorAll('.task-list').forEach(list => {
        list.addEventListener('dragover', handleDragOver);
        list.addEventListener('drop', handleDrop);
        list.addEventListener('dragleave', handleDragLeave);
    });

    // Atalhos de teclado
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });

    // Mobile Tabs Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons and columns
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('active'));

            // Add active class to clicked button
            btn.classList.add('active');

            // Show corresponding column
            const targetColumn = document.querySelector(`.column-${btn.dataset.target}`);
            if (targetColumn) {
                targetColumn.classList.add('active');
            }
        });
    });
}

// ========================================
// FIREBASE LISTENERS
// ========================================

function setupFirebaseListeners() {
    // Listener para sincronização em tempo real
    kanbanRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            // Converter arrays do Firebase para estrutura local
            state.tasks.todo = convertFirebaseArrayToLocal(data.todo);
            state.tasks.progress = convertFirebaseArrayToLocal(data.progress);
            state.tasks.done = convertFirebaseArrayToLocal(data.done);
        } else {
            // Inicializar estrutura vazia no Firebase
            state.tasks = { todo: [], progress: [], done: [] };
            saveTasks();
        }
        renderAllTasks();
    }, (error) => {
        console.error('Erro ao conectar com Firebase:', error);
        alert('Erro ao conectar com o banco de dados. Verifique as regras de segurança do Firebase.');
    });
}

// Converte array do Firebase (pode ter índices) para array local
function convertFirebaseArrayToLocal(firebaseArray) {
    if (!firebaseArray) return [];

    // Se for um objeto com índices, converte para array
    if (typeof firebaseArray === 'object' && !Array.isArray(firebaseArray)) {
        return Object.values(firebaseArray).filter(item => item !== null && item !== undefined);
    }

    // Se já for array, filtra valores nulos
    return Array.isArray(firebaseArray)
        ? firebaseArray.filter(item => item !== null && item !== undefined)
        : [];
}


// ========================================
// MODAL
// ========================================

function openModal() {
    if (state.editingTask) {
        modalTitle.textContent = 'Editar Tarefa';
        taskTitleInput.value = state.editingTask.title;
        taskDescriptionInput.value = state.editingTask.description || '';
        taskPriorityInput.value = state.editingTask.priority || 'low'; // Default low
    } else {
        modalTitle.textContent = 'Nova Tarefa';
        taskForm.reset();
        taskPriorityInput.value = 'low'; // Default para nova tarefa
    }
    modal.classList.add('active');
    taskTitleInput.focus();
}

function closeModal() {
    modal.classList.remove('active');
    taskForm.reset();
    state.editingTask = null;
}

function handleTaskSubmit(e) {
    e.preventDefault();
    const title = taskTitleInput.value;
    const description = taskDescriptionInput.value;
    const priority = taskPriorityInput.value;

    if (state.editingTask) {
        editTask(state.editingTask.id, { title, description, priority });
    } else {
        const task = createTask(title, description, priority, state.currentColumn);
        addTask(task);
    }

    closeModal();
}

function createTask(title, description, priority, column) {
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: title.trim(),
        description: description.trim(),
        priority: priority || 'low',
        column: column,
        createdAt: new Date().toISOString()
    };
}

function addTask(task) {
    state.tasks[task.column].push(task);
    saveTasks();
}

function editTask(taskId, updates) {
    for (let column in state.tasks) {
        const taskIndex = state.tasks[column].findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            state.tasks[column][taskIndex] = {
                ...state.tasks[column][taskIndex],
                ...updates
            };
            saveTasks();
            return;
        }
    }
}

function deleteTask(taskId) {
    for (let column in state.tasks) {
        const taskIndex = state.tasks[column].findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            state.tasks[column].splice(taskIndex, 1);
            saveTasks();
            return;
        }
    }
}

function moveTask(taskId, fromColumn, toColumn) {
    const taskIndex = state.tasks[fromColumn].findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
        const task = state.tasks[fromColumn].splice(taskIndex, 1)[0];
        task.column = toColumn;
        state.tasks[toColumn].push(task);
        saveTasks();
    }
}

// ========================================
// RENDERIZAÇÃO
// ========================================

function renderAllTasks() {
    ['todo', 'progress', 'done'].forEach(column => {
        renderTasks(column);
        updateColumnCount(column);
    });
    updateStats();
}

function renderTasks(column) {
    const taskList = document.querySelector(`.task-list[data-column="${column}"]`);
    taskList.innerHTML = '';

    state.tasks[column].forEach(task => {
        const taskCard = createTaskCard(task);
        taskList.appendChild(taskCard);
    });
}

function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.draggable = true;
    card.dataset.taskId = task.id;
    card.dataset.column = task.column;

    const timeAgo = getTimeAgo(task.createdAt);

    // Criar estrutura da tarefa
    const taskHeader = document.createElement('div');
    taskHeader.className = 'task-header';

    const taskTitle = document.createElement('div');
    taskTitle.className = 'task-title';
    taskTitle.textContent = task.title;

    const taskActions = document.createElement('div');
    taskActions.className = 'task-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'task-btn edit';
    editBtn.textContent = '✏️';
    editBtn.title = 'Editar';
    editBtn.onclick = () => handleEditTask(task.id);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'task-btn delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Excluir';
    deleteBtn.onclick = () => handleDeleteTask(task.id);

    taskActions.appendChild(editBtn);
    taskActions.appendChild(deleteBtn);
    taskHeader.appendChild(taskTitle);
    taskHeader.appendChild(taskActions);
    card.appendChild(taskHeader);

    // Adicionar descrição se existir
    if (task.description) {
        const taskDesc = document.createElement('div');
        taskDesc.className = 'task-description';
        // Processar links e quebras de linha
        taskDesc.innerHTML = linkify(escapeHtml(task.description));
        card.appendChild(taskDesc);
    }

    // Adicionar metadados
    const taskMeta = document.createElement('div');
    taskMeta.className = 'task-meta';

    // Prioridade
    const priorityBadge = document.createElement('span');
    const priorityMap = {
        'high': { text: 'Alta', class: 'priority-high' },
        'medium': { text: 'Média', class: 'priority-medium' },
        'low': { text: 'Baixa', class: 'priority-low' }
    };
    // Fallback para 'low' se não houver prioridade definida
    const priorityConfig = priorityMap[task.priority] || priorityMap['low'];

    priorityBadge.className = `priority-badge ${priorityConfig.class}`;
    priorityBadge.textContent = priorityConfig.text;

    const taskTime = document.createElement('div');
    taskTime.className = 'task-time';
    taskTime.innerHTML = `<span>🕐</span><span>${timeAgo}</span>`;

    taskMeta.appendChild(priorityBadge);
    taskMeta.appendChild(taskTime);
    card.appendChild(taskMeta);

    // Eventos de drag
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    return card;
}

function updateColumnCount(column) {
    const badge = document.querySelector(`[data-count="${column}"]`);
    if (badge) {
        badge.textContent = state.tasks[column].length;
    }
}

function updateStats() {
    document.getElementById('stat-todo').textContent = state.tasks.todo.length;
    document.getElementById('stat-progress').textContent = state.tasks.progress.length;
    document.getElementById('stat-done').textContent = state.tasks.done.length;
}

// ========================================
// DRAG AND DROP
// ========================================

let draggedElement = null;

function handleDragStart(e) {
    draggedElement = e.currentTarget;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.task-list').forEach(list => {
        list.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
}

function handleDragLeave(e) {
    if (e.currentTarget === e.target) {
        e.currentTarget.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    e.preventDefault();
    const dropZone = e.currentTarget;
    dropZone.classList.remove('drag-over');

    if (draggedElement) {
        const taskId = draggedElement.dataset.taskId;
        const fromColumn = draggedElement.dataset.column;
        const toColumn = dropZone.dataset.column;

        if (fromColumn !== toColumn) {
            moveTask(taskId, fromColumn, toColumn);
        }
    }
}

// ========================================
// HANDLERS DE AÇÕES
// ========================================

function handleEditTask(taskId) {
    for (let column in state.tasks) {
        const task = state.tasks[column].find(t => t.id === taskId);
        if (task) {
            state.editingTask = task;
            state.currentColumn = column;
            openModal();
            return;
        }
    }
}

function handleDeleteTask(taskId) {
    if (confirm('Tem certeza que deseja excluir esta tarefa?')) {
        deleteTask(taskId);
    }
}

// ========================================
// FIREBASE DATABASE
// ========================================

function saveTasks() {
    try {
        // Converter arrays para formato com índices explícitos
        const dataToSave = {
            todo: convertLocalArrayToFirebase(state.tasks.todo),
            progress: convertLocalArrayToFirebase(state.tasks.progress),
            done: convertLocalArrayToFirebase(state.tasks.done)
        };

        // Salvar no Firebase
        kanbanRef.set(dataToSave)
            .catch(error => {
                console.error('Erro ao salvar no Firebase:', error);
                alert('Erro ao salvar. Verifique as regras de segurança do Firebase.');
            });
    } catch (e) {
        console.error('Erro ao salvar tarefas:', e);
    }
}

// Converte array local para formato Firebase com índices numéricos
function convertLocalArrayToFirebase(localArray) {
    if (!localArray || localArray.length === 0) return {};

    // Criar objeto com índices numéricos (0, 1, 2, etc.)
    const firebaseObject = {};
    localArray.forEach((item, index) => {
        firebaseObject[index] = item;
    });

    return firebaseObject;
}

// ========================================
// UTILITÁRIOS
// ========================================

function getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'agora';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m atrás`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atrás`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d atrás`;
    return new Date(dateString).toLocaleDateString('pt-BR');
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function linkify(text) {
    if (!text) return '';
    // Expressão regular para detectar URLs
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

    // Substitui URLs por tags <a> e mantém quebras de linha
    return text
        .replace(urlRegex, function (url) {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: underline;">${url}</a>`;
        })
        .replace(/\n/g, '<br>');
}
