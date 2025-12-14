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
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// Estado da aplicação
const state = {
    user: null,
    currentBoardId: null,
    currentRole: 'viewer', // 'owner' | 'admin' | 'viewer'
    boards: {}, // Cache de painéis
    tasks: {
        todo: [],
        progress: [],
        done: []
    },
    currentColumn: null,
    editingTask: null,
    boardListeners: [] // Para limpar listeners ao sair do board
};

// DOM Elements
const views = {
    login: document.getElementById('loginView'),
    dashboard: document.getElementById('dashboardView'),
    board: document.getElementById('boardView')
};

// ========================================
// TRASH BIN LOGIC
// ========================================


function showLoader() {
    const loader = document.getElementById('loadingOverlay');
    if (loader) loader.classList.add('active');
}

function hideLoader() {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        // Small delay to ensure smooth transition
        setTimeout(() => {
            loader.classList.remove('active');
        }, 500);
    }
}

window.moveToTrash = function (boardId) {
    // Permission Check
    if (state.currentRole !== 'owner') {
        alert("Você não tem permissão para excluir este painel.");
        return;
    }

    if (confirm('Mover este painel para a lixeira?')) {
        const updates = {};
        updates[`boards/${boardId}/meta/trashed`] = true;
        updates[`boards/${boardId}/meta/trashedAt`] = new Date().toISOString();

        database.ref().update(updates).then(() => {
            console.log(`Board ${boardId} moved to trash.`);
            // If inside the board, redirect to dashboard
            if (state.currentBoardId === boardId) {
                showView('dashboard');
                state.currentBoardId = null;
            }
            // Always reload boards to update grid and trash FAB
            loadUserBoards();
        });
    }
}


window.editBoardTitle = function () {
    if (state.currentRole !== 'owner' && state.currentRole !== 'admin') {
        alert("Permissão negada.");
        return;
    }

    const currentTitle = document.getElementById('boardTitleDisplay').textContent.trim();
    const newTitle = prompt("Novo nome do painel:", currentTitle);

    if (newTitle && newTitle.trim() !== "" && newTitle !== currentTitle) {
        database.ref(`boards/${state.currentBoardId}/meta/name`).set(newTitle.trim())
            .then(() => {
                document.getElementById('boardTitleDisplay').textContent = newTitle.trim();
                loadUserBoards(); // Force reload to update grid

                const sideTitle = document.getElementById('sideMenuTitle');
                if (sideTitle) sideTitle.textContent = newTitle.trim();
            })
            .catch(err => {
                console.error("Erro ao renomear:", err);
                alert("Erro ao renomear painel.");
            });
    }
};

window.restoreBoard = function (boardId) {
    if (confirm('Restaurar este painel da lixeira?')) {
        database.ref(`boards/${boardId}/meta/trashed`).set(false).then(() => {
            console.log(`Board ${boardId} restaurado.`);

            // Redirect to dashboard if any board is currently open
            if (state.currentBoardId) {
                showView('dashboard');
                state.currentBoardId = null;
            }

            loadUserBoards();
        });
    }
};

// ========================================
// FIREBASE - BOARD LOGIC
// ========================================

function openBoard(boardId, boardName) {
    if (state.currentBoardId === boardId) {
        showView('board');
        return;
    }

    // Limpar listeners anteriores
    state.boardListeners.forEach(off => off());
    state.boardListeners = [];

    state.currentBoardId = boardId;
    document.getElementById('boardTitleDisplay').textContent = boardName;
    const sideTitle = document.getElementById('sideMenuTitle');
    if (sideTitle) sideTitle.textContent = boardName;

    // Show loader immediately
    showLoader();

    // Buscar permissão do usuário atual
    database.ref(`board_members/${boardId}/${state.user.uid}`).once('value').then(snap => {
        state.currentRole = snap.val() || 'viewer';
        console.log("Current Role:", state.currentRole);
        applyRolePermissions();
    });

    // Configurar listeners para este board
    const tasksRef = database.ref(`boards/${boardId}/tasks`);

    // Listener de valor para manter sync
    const listener = tasksRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state.tasks.todo = convertFirebaseArrayToLocal(data.todo);
            state.tasks.progress = convertFirebaseArrayToLocal(data.progress);
            state.tasks.done = convertFirebaseArrayToLocal(data.done);
        } else {
            state.tasks = { todo: [], progress: [], done: [] };
        }
        renderAllTasks();
        // Hide loader when data is received and rendered
        hideLoader();
    });

    state.boardListeners.push(() => tasksRef.off('value', listener));

    showView('board');
}

function applyRolePermissions() {
    const isAdmin = state.currentRole === 'owner' || state.currentRole === 'admin';
    const isViewer = !isAdmin;

    // Toggle Add Task Buttons
    document.querySelectorAll('.add-task-btn').forEach(btn => {
        btn.style.display = isAdmin ? 'flex' : 'none';
    });

    // Toggle Trash Board Button (Owner Only)
    // Toggle Trash Board Button (Owner Only)
    const trashBtn = document.getElementById('trashBoardBtn');
    if (trashBtn) {
        trashBtn.style.display = (state.currentRole === 'owner') ? 'block' : 'none';
    }

    // Toggle Edit Title Button (Owner or Admin)
    const editTitleBtn = document.getElementById('editBoardTitleBtn');
    if (editTitleBtn) {
        editTitleBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }

    // Re-render tasks to update edit/delete buttons
    renderAllTasks();
}

function saveTasks() {
    if (!state.currentBoardId) return;
    if (state.currentRole !== 'owner' && state.currentRole !== 'admin') {
        console.warn("Permissão negada para salvar.");
        return;
    }

    try {
        const tasksRef = database.ref(`boards/${state.currentBoardId}/tasks`);
        const dataToSave = {
            todo: convertLocalArrayToFirebase(state.tasks.todo),
            progress: convertLocalArrayToFirebase(state.tasks.progress),
            done: convertLocalArrayToFirebase(state.tasks.done)
        };

        tasksRef.set(dataToSave).catch(error => {
            console.error('Erro ao salvar:', error);
        });
    } catch (e) {
        console.error('Erro ao salvar tarefas:', e);
    }
}

// ========================================
// INICIALIZAÇÃO & AUTH
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    setupAuthListener();
    setupEventListeners();
});

function setupAuthListener() {
    auth.onAuthStateChanged(user => {
        if (user) {
            state.user = user;
            // Atualizar perfil do usuário no banco (com índice de email)
            updateUserProfile(user);
            updateUIForLogin();
            loadUserBoards();
            showView('dashboard');
        } else {
            state.user = null;
            showView('login');
        }
    });
}

function updateUserProfile(user) {
    const sanitizedEmail = user.email.replace(/\./g, ',');
    const userRef = database.ref(`users/${user.uid}`);
    const emailRef = database.ref(`email_to_uid/${sanitizedEmail}`);
    const pendingInvitesRef = database.ref(`pending_invites/${sanitizedEmail}`);

    userRef.update({
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y', // Fallback
        lastLogin: new Date().toISOString()
    });

    // Criar índice reverso email -> uid
    emailRef.set(user.uid);

    // Verificar convites pendentes
    pendingInvitesRef.once('value').then(snapshot => {
        const invites = snapshot.val();
        if (invites) {
            const updates = {};
            Object.keys(invites).forEach(boardId => {
                updates[`user_boards/${user.uid}/${boardId}`] = true;
                // Como é convite, assume role 'viewer' ou o que estava salvo
                updates[`board_members/${boardId}/${user.uid}`] = invites[boardId] || 'viewer';
            });
            // Remover pendências
            updates[`pending_invites/${sanitizedEmail}`] = null;

            database.ref().update(updates).then(() => {
                console.log("Convites pendentes processados.");
                // Recarregar boards se já estivermos na tela de dashboard?
                // O listener de user_boards cuidará disso automaticamente
            });
        }
    });
}

function loginWithGoogle() {
    auth.signInWithPopup(googleProvider).catch(error => {
        console.error("Erro no login:", error);
        alert(`Erro ao fazer login: ${error.code}\n${error.message}`);
    });
}

function logout() {
    auth.signOut().then(() => {
        // Limpar estado
        state.boards = {};
        state.currentBoardId = null;
    });
}

// ========================================
// NAVEGAÇÃO
// ========================================

function showView(viewName) {
    // Hide all
    Object.values(views).forEach(el => el.classList.remove('active'));
    // Show target
    views[viewName].classList.add('active');

    if (viewName === 'board') {
        // Ajuste específico para mobile se necessário
    }
}

function updateUIForLogin() {
    document.getElementById('userName').textContent = state.user.displayName;
    document.getElementById('userAvatar').src = state.user.photoURL;
}

// ========================================
// FIREBASE - DASHBOARD LOGIC
// ========================================

function closeCreateBoardModal() {
    document.getElementById('createBoardModal').classList.remove('active');
}

function closeParticipantsModal() {
    document.getElementById('participantsModal').classList.remove('active');
}

function loadUserBoards() {
    const userBoardsRef = database.ref(`user_boards/${state.user.uid}`);

    // Remove previous listener if exists to prevent duplicates
    if (state.dashboardListener) {
        state.dashboardListenerRef.off('value', state.dashboardListener);
    }

    state.dashboardListenerRef = userBoardsRef;
    state.dashboardListener = userBoardsRef.on('value', (snapshot) => {
        const boardsData = snapshot.val();
        const boardsGrid = document.getElementById('boardsGrid');

        // Trash counter logic
        let trashCount = 0;
        const trashList = []; // Store trashed meta for sidebar

        boardsGrid.innerHTML = '';

        if (!boardsData) {
            boardsGrid.innerHTML = '<p style="color:var(--text-secondary); width:100%; text-align:center;">Você ainda não tem painéis.</p>';
            updateTrashBadge(0);
            return;
        }

        const boardKeys = Object.keys(boardsData);
        let processed = 0;
        // Handle case where boardKeys is empty but boardsData object exists (unlikely but safe)
        if (boardKeys.length === 0) {
            boardsGrid.innerHTML = '<p style="color:var(--text-secondary); width:100%; text-align:center;">Você ainda não tem painéis.</p>';
            updateTrashBadge(0);
            return;
        }

        boardKeys.forEach(boardId => {
            database.ref(`boards/${boardId}/meta`).once('value').then(snap => {
                const meta = snap.val();
                if (meta) {
                    if (meta.trashed && meta.owner === state.user.uid) {
                        trashCount++;
                        trashList.push({ id: boardId, ...meta });
                    } else if (!meta.trashed) {
                        const card = createBoardCard(boardId, meta);
                        boardsGrid.appendChild(card);
                    }
                } else {
                    // Board might have been deleted but still in user_boards?
                    // Should probably clean up here too, but for now just ignore
                }

                processed++;
                if (processed === boardKeys.length) {
                    updateTrashBadge(trashCount);
                    updateTrashFabVisibility(trashCount);
                    window.currentTrashList = trashList; // Store globally for sidebar rendering
                    if (document.getElementById('trashSidebar').classList.contains('active')) renderTrashList();
                }
            });
        });
    });
}

function updateTrashBadge(count) {
    const badge = document.getElementById('trashCount');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none'; // Optional: hide if 0? Request says "show a number", implies existence. Let's keep distinct.
        // Actually, user said "show a number", so always showing 0 is fine, or hiding. Standard is hiding.
        // Let's keep it visible if requested to "show a number".
        badge.style.display = 'flex';
    }
}

function updateTrashFabVisibility(trashCount) {
    const fab = document.getElementById('trashFab');
    if (!fab) return;

    const isOwnerOfAny = trashCount > 0;
    fab.style.display = isOwnerOfAny ? 'flex' : 'none';
}

function renderTrashList() {
    const list = document.getElementById('trashList');
    if (!list) return;
    list.innerHTML = '';

    const trashItems = window.currentTrashList || [];

    if (trashItems.length === 0) {
        list.innerHTML = '<li style="color:var(--text-secondary); text-align:center;">Lixeira vazia</li>';
        return;
    }

    trashItems.forEach(item => {
        const li = document.createElement('li');
        li.className = 'trash-item';
        const dateStr = item.trashedAt ? new Date(item.trashedAt).toLocaleDateString() : 'Recentemente';
        li.innerHTML = `
            <div class="trash-info">
                <strong>${item.name}</strong>
                <br>
                <small style="color:var(--text-secondary)">Excluído em: ${dateStr}</small>
            </div>
            <div class="trash-actions">
                <button onclick="restoreBoard('${item.id}')" class="btn-icon" title="Restaurar" style="color:var(--accent-green)">♻️</button>
                <button onclick="deleteBoardPermanently('${item.id}')" class="btn-icon" title="Excluir Permanentemente" style="color:var(--danger)">🔥</button>
            </div>
        `;
        list.appendChild(li);
    });
}

window.restoreBoard = function (boardId) {
    if (confirm('Restaurar este painel?')) {
        database.ref(`boards/${boardId}/meta/trashed`).set(false).then(() => {
            console.log(`Board ${boardId} restored.`);
            // Force reload logic by calling listeners again?
            // Since we detached/re-attached safely, we can call loadUserBoards()
            // However, the cleanest way is just to manually trigger the internal logic.
            // But re-calling loadUserBoards is safe now.
            loadUserBoards();
        });
    }
};

window.deleteBoardPermanently = function (boardId) {
    if (confirm('ATENÇÃO: Isso excluirá o painel e TODAS as tarefas permanentemente!')) {
        const updates = {};
        updates[`boards/${boardId}`] = null;
        updates[`user_boards/${state.user.uid}/${boardId}`] = null;
        updates[`board_members/${boardId}`] = null;

        database.ref().update(updates).then(() => {
            console.log(`Board ${boardId} permanently deleted.`);
            // The user_boards listener should catch this automatically now
        });
    }
};

function createBoardCard(boardId, meta) {
    const div = document.createElement('div');
    div.className = 'board-card';
    const isOwner = meta.owner === state.user.uid;

    div.innerHTML = `
        <div style="flex:1">
            <h3>${meta.name}</h3>
           
        </div>
        <div class="board-meta">
            <span style="font-size:0.8rem; color:var(--text-secondary);">Criado em: ${new Date(meta.createdAt).toLocaleDateString()}</span>
            ${isOwner ? '<span class="priority-badge priority-low" style="margin-left:auto;">PROPRIETÁRIO</span>' : '<span class="priority-badge priority-medium" style="margin-left:auto;">CONVIDADO</span>'}
        </div>
    `;

    // Adding main listener:
    div.addEventListener('click', (e) => {
        console.log("Board clicked:", boardId);
        openBoard(boardId, meta.name);
    });
    return div;
}

function createNewBoard(name) {
    const newBoardRef = database.ref('boards').push();
    const boardId = newBoardRef.key;

    const boardData = {
        meta: {
            name: name,
            owner: state.user.uid,
            createdAt: new Date().toISOString(),
            description: ''
        }
    };

    // Atualizações atômicas
    const updates = {};
    updates[`boards/${boardId}`] = boardData;
    updates[`user_boards/${state.user.uid}/${boardId}`] = true;
    updates[`board_members/${boardId}/${state.user.uid}`] = 'owner';

    // Salvar
    database.ref().update(updates).then(() => {
        closeCreateBoardModal();
        // Não precisamos forçar reload, o listener on('value') fará isso
    }).catch(error => {
        console.error("Erro ao criar painel:", error);
        alert("Erro ao criar painel: " + error.message);
    });
}

function addMemberToBoard(email, role) {
    if (!state.currentBoardId) return;

    const sanitizedEmail = email.replace(/\./g, ',');
    const emailIndexRef = database.ref(`email_to_uid/${sanitizedEmail}`);

    emailIndexRef.once('value').then(snapshot => {
        const uid = snapshot.val();
        if (uid) {
            // Usuário encontrado - Adicionar diretamente
            const updates = {};
            updates[`user_boards/${uid}/${state.currentBoardId}`] = true;
            updates[`board_members/${state.currentBoardId}/${uid}`] = role;

            database.ref().update(updates).then(() => {
                alert(`Usuário ${email} adicionado com sucesso!`);
                document.getElementById('inviteMemberForm').reset();
                loadBoardMembers(); // Reload list
            }).catch(err => {
                console.error(err);
                alert("Erro ao adicionar permissões.");
            });
        } else {
            // Usuário não encontrado - Criar convite pendente
            const updates = {};
            // Path antigo para processamento no login
            updates[`pending_invites/${sanitizedEmail}/${state.currentBoardId}`] = role;
            // Novo path para visualização no dashboard do board
            updates[`board_invites/${state.currentBoardId}/${sanitizedEmail}`] = role;

            database.ref().update(updates).then(() => {
                alert(`Convite enviado para ${email} (${role}).\nO acesso será liberado no primeiro login.`);
                document.getElementById('inviteMemberForm').reset();
                loadBoardMembers(); // Reload list
            }).catch(error => {
                console.error("Erro ao criar convite:", error);
                alert("Erro ao enviar convite.");
            });
        }
    });
}

function loadBoardMembers() {
    if (!state.currentBoardId) return;
    const list = document.getElementById('membersList');
    list.innerHTML = '<li style="text-align:center;">Carregando...</li>';

    const membersRef = database.ref(`board_members/${state.currentBoardId}`);
    const invitesRef = database.ref(`board_invites/${state.currentBoardId}`);

    Promise.all([membersRef.once('value'), invitesRef.once('value')]).then(([memSnap, invSnap]) => {
        const members = memSnap.val() || {};
        const invites = invSnap.val() || {};
        list.innerHTML = '';

        // 1. Render Active Members
        const memberPromises = Object.keys(members).map(uid => {
            return database.ref(`users/${uid}`).once('value').then(uSnap => {
                const user = uSnap.val();
                return { uid, role: members[uid], ...user };
            });
        });

        Promise.all(memberPromises).then(users => {
            // Sort: Owner first, then others
            users.sort((a, b) => (a.role === 'owner' ? -1 : 1));

            users.forEach(u => {
                const li = document.createElement('li');
                li.className = 'member-item';
                const isMe = u.uid === state.user.uid;
                const canManage = (state.currentRole === 'owner' || state.currentRole === 'admin') && !isMe;

                const roleDisplay = {
                    'owner': 'PROPRIETÁRIO',
                    'admin': 'Administrador',
                    'viewer': 'Visualizador'
                };

                li.innerHTML = `
                    <div class="member-info">
                        <img src="${u.photoURL || 'https://www.gravatar.com/avatar?d=mp'}" alt="Avatar" class="member-avatar">
                        <div>
                            <div class="member-name">${u.displayName || 'Usuário'} ${isMe ? '(Você)' : ''}</div>
                            <div class="member-email">${u.email}</div>
                        </div>
                    </div>
                    <div class="member-actions">
                        ${canManage ? `
                            <select onchange="changeMemberRole('${u.uid}', this.value)" class="role-select">
                                <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Visualizador</option>
                                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
                            </select>
                            <button onclick="removeMember('${u.uid}')" class="btn-icon delete" title="Remover">❌</button>
                        ` : `<span class="role-badge">${roleDisplay[u.role] || u.role}</span>`}
                        ${isMe && u.role !== 'owner' ? `<button onclick="leaveBoard()" class="role-select" style="margin-left:5px">Sair</button>` : ''}
                    </div>
                `;
                list.appendChild(li);
            });

            // 2. Render Pending Invites
            Object.keys(invites).forEach(emailKey => {
                const email = emailKey.replace(/,/g, '.');
                const role = invites[emailKey];
                const roleDisplay = {
                    'owner': 'PROPRIETÁRIO',
                    'admin': 'Administrador',
                    'viewer': 'Visualizador'
                };
                const li = document.createElement('li');
                li.className = 'member-item pending';
                li.innerHTML = `
                    <div class="member-info">
                        <div class="member-avatar pending">?</div>
                        <div>
                            <div class="member-name">${email}</div>
                            <div class="member-email" style="color:var(--warning);">Convite Pendente</div>
                        </div>
                    </div>
                    <div class="member-actions">
                         ${(state.currentRole === 'owner' || state.currentRole === 'admin') ? `
                            <select onchange="changeInviteRole('${emailKey}', this.value)" class="role-select">
                                <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>Visualizador</option>
                                <option value="admin" ${role === 'admin' ? 'selected' : ''}>Administrador</option>
                            </select>
                            <button onclick="cancelInvite('${emailKey}')" class="btn-icon delete" title="Cancelar Convite">🗑️</button>
                        ` : `<span class="role-badge">${roleDisplay[role] || role}</span>`}
                    </div>
                `;
                list.appendChild(li);
            });
        });
    });
}

// Global functions for inline onclicks (simplest way given strict mode limitations might apply if modules used, but here valid)
window.changeMemberRole = function (uid, newRole) {
    database.ref(`board_members/${state.currentBoardId}/${uid}`).set(newRole);
    loadBoardMembers();
};

window.removeMember = function (uid) {
    if (confirm('Remover este usuário do painel?')) {
        const updates = {};
        updates[`board_members/${state.currentBoardId}/${uid}`] = null;
        updates[`user_boards/${uid}/${state.currentBoardId}`] = null;
        database.ref().update(updates).then(loadBoardMembers);
    }
};

window.changeInviteRole = function (emailKey, newRole) {
    const updates = {};
    updates[`pending_invites/${emailKey}/${state.currentBoardId}`] = newRole;
    updates[`board_invites/${state.currentBoardId}/${emailKey}`] = newRole;
    database.ref().update(updates).then(loadBoardMembers);
};

window.cancelInvite = function (emailKey) {
    if (confirm('Cancelar convite?')) {
        const updates = {};
        updates[`pending_invites/${emailKey}/${state.currentBoardId}`] = null;
        updates[`board_invites/${state.currentBoardId}/${emailKey}`] = null;
        database.ref().update(updates).then(loadBoardMembers);
    }
};

window.leaveBoard = function () {
    if (confirm('Sair do painel?')) {
        const updates = {};
        updates[`board_members/${state.currentBoardId}/${state.user.uid}`] = null;
        updates[`user_boards/${state.user.uid}/${state.currentBoardId}`] = null;
        database.ref().update(updates).then(() => {
            closeParticipantsModal();
            showView('dashboard');
        });
    }
};

// ========================================


// ========================================
// UTILS & CONVERSION
// ========================================

function convertFirebaseArrayToLocal(firebaseData) {
    if (!firebaseData) return [];
    if (Array.isArray(firebaseData)) return firebaseData.filter(i => i);
    return Object.values(firebaseData);
}

function convertLocalArrayToFirebase(localArray) {
    if (!localArray || localArray.length === 0) return {};
    const obj = {};
    localArray.forEach((item, index) => obj[index] = item);
    return obj;
}

// ========================================
// EVENT LISTENERS
// ========================================

function setupEventListeners() {
    // Auth
    // Auth (Global Delegation for Robustness)
    document.body.addEventListener('click', (e) => {
        const loginBtn = e.target.closest('#googleLoginBtn');
        if (loginBtn) {
            console.log("Login button clicked (Delegated)");
            loginWithGoogle();
        }
    });
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Dashboard Actions
    document.getElementById('createBoardBtn').addEventListener('click', () => {
        document.getElementById('createBoardForm').reset();
        document.getElementById('createBoardModal').classList.add('active');
    });

    document.getElementById('createBoardForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('boardName').value;
        if (name) createNewBoard(name);
    });

    // Board Navigation
    document.getElementById('backToDashBtn').addEventListener('click', () => {
        state.currentBoardId = null; // Force reload when entering board again
        // Limpar listeners do board atual para economizar recursos? Pode ser.
        showView('dashboard');
    });

    // Edit Board Title Listener
    const editTitleBtn = document.getElementById('editBoardTitleBtn');
    if (editTitleBtn) editTitleBtn.addEventListener('click', editBoardTitle);

    const mobileBack = document.getElementById('mobileBackToDash');
    if (mobileBack) mobileBack.addEventListener('click', () => {
        state.currentBoardId = null;
        showView('dashboard');
    });



    // Default Trash Sidebar Logic
    const fab = document.getElementById('trashFab');
    const sidebar = document.getElementById('trashSidebar');
    const overlay = document.getElementById('trashOverlay');
    const closeBtn = document.getElementById('closeTrashBtn');

    function toggleTrash() {
        if (sidebar) sidebar.classList.toggle('active');
        if (overlay) overlay.classList.toggle('active');
        if (sidebar && sidebar.classList.contains('active')) renderTrashList();
    }

    if (fab) fab.addEventListener('click', toggleTrash);
    if (closeBtn) closeBtn.addEventListener('click', toggleTrash);
    if (overlay) overlay.addEventListener('click', toggleTrash);

    // Member Management (Delegated Event)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('#addMemberBtn');
        if (btn) {
            console.log("Delegated click: Opening participants modal");
            const form = document.getElementById('inviteMemberForm');
            if (form) form.reset();

            // Carregar a lista de membros
            if (typeof loadBoardMembers === 'function') {
                loadBoardMembers();
            }

            const modal = document.getElementById('participantsModal');
            if (modal) modal.classList.add('active');
            else console.error("participantsModal not found");
        }
    });

    const inviteMemberForm = document.getElementById('inviteMemberForm');
    if (inviteMemberForm) {
        inviteMemberForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('inviteEmail').value;
            const role = document.getElementById('inviteRole').value;
            if (email) addMemberToBoard(email, role);
        });
    }

    // --- KANBAN LOGIC (Mantida do anterior, ajustada para usar state global) ---

    // Cancelar Modais
    document.getElementById('cancelCreateBoardBtn').addEventListener('click', closeCreateBoardModal);
    document.getElementById('closeParticipantsBtn').addEventListener('click', closeParticipantsModal);

    // Also allow closing by clicking outside? Handled for taskModal but not others?
    // Let's add simple outside click close for these too
    ['createBoardModal', 'participantsModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('active'); });
    });

    // Botões de adicionar tarefa
    document.querySelectorAll('.add-task-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.currentColumn = btn.dataset.column;
            state.editingTask = null;
            openModal();
        });
    });

    // Modal de Tarefa
    const taskForm = document.getElementById('taskForm');
    const modal = document.getElementById('taskModal');
    const cancelBtn = document.getElementById('cancelBtn');

    taskForm.addEventListener('submit', handleTaskSubmit);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // Drag and Drop Wrappers
    document.querySelectorAll('.task-list').forEach(list => {
        list.addEventListener('dragover', handleDragOver);
        list.addEventListener('drop', handleDrop);
        list.addEventListener('dragleave', handleDragLeave);
    });

    // Side Menu Mobile
    const menuToggles = document.querySelectorAll('.menu-toggle-btn');
    const menuOverlay = document.getElementById('menuOverlay');
    const sideMenu = document.getElementById('sideMenu');

    function toggleMenu() {
        if (sideMenu) sideMenu.classList.toggle('active');
        if (menuOverlay) menuOverlay.classList.toggle('active');
    }

    menuToggles.forEach(btn => btn.addEventListener('click', toggleMenu));
    if (menuOverlay) menuOverlay.addEventListener('click', toggleMenu);

    // Mobile Tab Navigation (Only for buttons with data-target)
    document.querySelectorAll('.side-nav-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remove active class from all tab buttons
            document.querySelectorAll('.side-nav-btn[data-target]').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetColumn = document.querySelector(`.column-${btn.dataset.target}`);
            if (targetColumn) targetColumn.classList.add('active');
            toggleMenu();
        });
    });

    const mobileParticipantsBtn = document.getElementById('mobileParticipantsBtn');
    if (mobileParticipantsBtn) {
        mobileParticipantsBtn.addEventListener('click', () => {
            // Reusing the logic from the main addMemberBtn
            // We can just trigger a click on it if it exists, or replicate logic.
            // Replicating logic is safer if the main button is hidden/different context
            const form = document.getElementById('inviteMemberForm');
            if (form) form.reset();
            if (typeof loadBoardMembers === 'function') loadBoardMembers();
            const modal = document.getElementById('participantsModal');
            if (modal) modal.classList.add('active');

            toggleMenu(); // Close side menu
        });

    }

    const trashBoardBtn = document.getElementById('trashBoardBtn');
    if (trashBoardBtn) {
        trashBoardBtn.addEventListener('click', () => {
            console.log("Desktop Trash button clicked", state.currentBoardId);
            if (state.currentBoardId) {
                moveToTrash(state.currentBoardId);
            }
        });
    }

    // Listener for Mobile Trash Button
    const mobileTrashBtn = document.getElementById('mobileTrashBoardBtn');
    if (mobileTrashBtn) {
        mobileTrashBtn.addEventListener('click', () => {
            console.log("Mobile Trash button clicked", state.currentBoardId);
            if (state.currentBoardId) {
                moveToTrash(state.currentBoardId);
                toggleMenu();
            }
        });
    }

    // Task Search Listeners
    document.querySelectorAll('.task-search-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const column = e.target.dataset.column;
            const taskList = document.querySelector(`.task-list[data-column="${column}"]`);

            if (taskList) {
                const tasks = taskList.querySelectorAll('.task-card');
                tasks.forEach(card => {
                    const title = card.querySelector('.task-title').textContent.toLowerCase();
                    if (title.includes(query)) {
                        card.classList.remove('hidden');
                    } else {
                        card.classList.add('hidden');
                    }
                });
            }
        });
    });
}

// ========================================
// KANBAN CORE (Mantido e Adaptado)
// ========================================

function openModal() {
    const modal = document.getElementById('taskModal');
    const titleInput = document.getElementById('taskTitle');
    const descInput = document.getElementById('taskDescription');
    const prioInput = document.getElementById('taskPriority');
    const modalTitle = document.getElementById('modalTitle');

    if (state.editingTask) {
        modalTitle.textContent = 'Editar Tarefa';
        titleInput.value = state.editingTask.title;
        descInput.value = state.editingTask.description || '';
        prioInput.value = state.editingTask.priority || 'low';
    } else {
        modalTitle.textContent = 'Nova Tarefa';
        document.getElementById('taskForm').reset();
        prioInput.value = 'low';
    }
    modal.classList.add('active');
    titleInput.focus();
}

function closeModal() {
    document.getElementById('taskModal').classList.remove('active');
    document.getElementById('taskForm').reset();
    state.editingTask = null;
}

function handleTaskSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('taskTitle').value;
    const description = document.getElementById('taskDescription').value;
    const priority = document.getElementById('taskPriority').value;

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
            state.tasks[column][taskIndex] = { ...state.tasks[column][taskIndex], ...updates };
            saveTasks();
            return;
        }
    }
}

function deleteTask(taskId) {
    if (confirm('Tem certeza que deseja excluir esta tarefa?')) {
        for (let column in state.tasks) {
            const index = state.tasks[column].findIndex(t => t.id === taskId);
            if (index !== -1) {
                state.tasks[column].splice(index, 1);
                saveTasks();
                return;
            }
        }
    }
}



// Renderização (Simplificada para usar as mesmas funções auxiliares)
function renderAllTasks() {
    ['todo', 'progress', 'done'].forEach(col => {
        const container = document.querySelector(`.task-list[data-column="${col}"]`);
        container.innerHTML = '';
        state.tasks[col].forEach(task => container.appendChild(createTaskCard(task)));

        // Updates counters
        const badge = document.querySelector(`[data-count="${col}"]`);
        if (badge) badge.textContent = state.tasks[col].length;
    });
    updateStats();
}

function updateStats() {
    ['todo', 'progress', 'done'].forEach(col => {
        const len = state.tasks[col].length;
        const stat = document.getElementById(`stat-${col}`);
        const statMob = document.getElementById(`stat-${col}-mobile`);
        if (stat) stat.textContent = len;
        if (statMob) statMob.textContent = len;
    });
}

// Drag & Drop Handlers
let draggedElement = null;

function handleDragStart(e) {
    draggedElement = e.currentTarget;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.task-list').forEach(list => list.classList.remove('drag-over'));
}


// Helper for Calculating Drop Position
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleDragOver(e) {
    e.preventDefault();
    const dropZone = e.currentTarget;
    dropZone.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';

    // Only attempt to reorder if we are dragging a task
    if (!draggedElement) return;

    const afterElement = getDragAfterElement(dropZone, e.clientY);

    if (afterElement == null) {
        dropZone.appendChild(draggedElement);
    } else {
        dropZone.insertBefore(draggedElement, afterElement);
    }
}

function handleDragLeave(e) {
    if (e.currentTarget === e.target) e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    const dropZone = e.currentTarget;
    dropZone.classList.remove('drag-over');

    if (!draggedElement) return;

    // The element is already in the right place in the DOM because of handleDragOver
    // Now we just need to read the DOM order and save it to Firebase

    const targetColumn = dropZone.dataset.column;
    const originColumn = draggedElement.dataset.column; // From dataset set at start

    // Check if changed columns
    const columnsToUpdate = [targetColumn];
    if (originColumn !== targetColumn) {
        columnsToUpdate.push(originColumn);
    }

    // Rebuild state from DOM for affected columns
    columnsToUpdate.forEach(col => {
        const list = document.querySelector(`.task-list[data-column="${col}"]`);
        const newTasks = [];

        if (list) {
            // Iterate DOM nodes
            list.querySelectorAll('.task-card').forEach(card => {
                const id = card.dataset.taskId;

                // Find logic: check everywhere because task might have moved
                // Ideally we have a better way, but finding by ID across all state arrays is safest
                let taskData = null;
                if (state.tasks.todo) taskData = state.tasks.todo.find(t => t.id === id);
                if (!taskData && state.tasks.progress) taskData = state.tasks.progress.find(t => t.id === id);
                if (!taskData && state.tasks.done) taskData = state.tasks.done.find(t => t.id === id);

                if (taskData) {
                    // Update column property
                    taskData.column = col;
                    // Update dataset too for consistency if we drag again immediately
                    card.dataset.column = col;
                    newTasks.push(taskData);
                }
            });
            // Update state
            state.tasks[col] = newTasks;
        }
    });

    // Save entire board state
    saveTasks();

    // Update stats immediately
    updateStats();
    ['todo', 'progress', 'done'].forEach(c => {
        const badge = document.querySelector(`[data-count="${c}"]`);
        if (badge && state.tasks[c]) badge.textContent = state.tasks[c].length;
    });

    draggedElement.classList.remove('dragging');
    draggedElement = null;
}

// --- DOM helpers from original (createTaskCard, timeAgo, linkify) ---
// (Reimplementing briefly to ensure context)

function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.draggable = true;
    card.dataset.taskId = task.id;
    card.dataset.column = task.column;

    // Events
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    // Content Construction
    const header = document.createElement('div');
    header.className = 'task-header';

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const edit = document.createElement('button');
    edit.className = 'task-btn edit';
    edit.innerHTML = '✏️';
    edit.onclick = () => {
        state.editingTask = task;
        state.currentColumn = task.column;
        openModal();
    };

    const del = document.createElement('button');
    del.className = 'task-btn delete';
    del.innerHTML = '🗑️';
    del.onclick = () => deleteTask(task.id);

    actions.append(edit, del);
    header.append(title, actions);
    card.appendChild(header);

    if (task.description) {
        const desc = document.createElement('div');
        desc.className = 'task-description';
        desc.innerHTML = linkify(escapeHtml(task.description));
        card.appendChild(desc);
    }

    // Meta
    const meta = document.createElement('div');
    meta.className = 'task-meta';

    // Priority
    const prioContainer = document.createElement('div');
    prioContainer.style.cssText = 'display:flex; align-items:center; gap:4px';
    const prioLabel = document.createElement('span');
    prioLabel.className = 'priority-label';
    prioLabel.textContent = 'Prioridade:';

    const prioBadge = document.createElement('span');
    const pMap = {
        high: { t: 'Alta', c: 'priority-high' },
        medium: { t: 'Média', c: 'priority-medium' },
        low: { t: 'Baixa', c: 'priority-low' }
    };
    const pConf = pMap[task.priority] || pMap.low;
    prioBadge.className = `priority-badge ${pConf.c}`;
    prioBadge.textContent = pConf.t;

    prioContainer.append(prioLabel, prioBadge);

    const time = document.createElement('div');
    time.className = 'task-time';
    time.innerHTML = `<span>🕐</span><span>${getTimeAgo(task.createdAt)}</span>`;

    meta.append(prioContainer, time);
    card.appendChild(meta);

    return card;
}

function getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'agora';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m atrás`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atrás`;
    return date.toLocaleDateString('pt-BR');
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function linkify(text) {
    if (!text) return '';
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    return text.replace(urlRegex, url => `<a href="${url}" target="_blank" style="color:var(--accent-blue); text-decoration:underline;">${url}</a>`).replace(/\n/g, '<br>');
}
