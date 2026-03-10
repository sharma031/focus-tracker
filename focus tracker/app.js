const state = {
    view: 'dashboard', // dashboard, active-session, summary
    sessions: [],
    activeSession: null,
    timers: {
        countdown: null,
        idle: null,
    },
    lastActivity: Date.now(),
    dom: {}, // To cache DOM elements
};

const sessionCompleteSound = new Audio("notification.mp3");

function cacheDOM() {
    state.dom = {
        views: {
            dashboard: document.getElementById('dashboard-view'),
            activeSession: document.getElementById('active-session-view'),
            summary: document.getElementById('summary-view'),
        },


forms: {
            session: document.getElementById('session-form'),
            taskName: document.getElementById('task-name'),
            duration: document.getElementById('duration'),
            idleThreshold: document.getElementById('idle-threshold'),
        },

active: {
            status: document.getElementById('session-status'),
            timer: document.getElementById('timer-display'),
            taskName: document.getElementById('active-task-name'),
            distractionCount: document.getElementById('distraction-count'),
            idleTime: document.getElementById('idle-time-display'),
            endBtn: document.getElementById('end-session-btn'),
        },
        summary: {
            score: document.getElementById('final-score'),
            task: document.getElementById('summary-task'),
            duration: document.getElementById('summary-duration'),
            distractions: document.getElementById('summary-distractions'),
            idle: document.getElementById('summary-idle'),
            backBtn: document.getElementById('back-to-dashboard-btn'),
        },
        dashboard: {
            historyList: document.getElementById('history-list'),
            totalFocus: document.getElementById('total-focus-time'),
            avgScore: document.getElementById('avg-focus-score'),
        },
        global: {
            resetBtn: document.getElementById('reset-app-btn'),
        }

};
}


// --- INITIALIZATION ---
function init() {
    cacheDOM();
    loadData();
    setupEventListeners();
    
// Check if there was an active session running
    if (state.activeSession && state.activeSession.isActive) {
        recoverSession();
    } else {
        renderHistory();
        switchView('dashboard');
    }
}


// --- EVENT LISTENERS ---
function setupEventListeners() {
    state.dom.forms.session.addEventListener('submit', handleStartSession);
    state.dom.active.endBtn.addEventListener('click', stopSession);
    state.dom.summary.backBtn.addEventListener('click', () => switchView('dashboard'));
    state.dom.global.resetBtn.addEventListener('click', resetAllData);
}


// Visibility API
    document.addEventListener('visibilitychange', handleVisibilityChange);



// Idle Detection
    ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => {
        document.addEventListener(evt, resetIdleTimer);
    });


// --- SESSION MANAGEMENT ---
function handleStartSession(e) {
    e.preventDefault();
    
    const taskName = state.dom.forms.taskName.value.trim();
    const durationMinutes = parseInt(state.dom.forms.duration.value, 10);
    const idleThresholdSeconds = parseInt(state.dom.forms.idleThreshold.value, 10);

if (!taskName || isNaN(durationMinutes)) return;
    
    const now = Date.now();
    
    const newSession = {
        id: crypto.randomUUID(),
        taskName,
        plannedDurationMs: durationMinutes * 60 * 1000,
        idleThresholdMs: idleThresholdSeconds * 1000,
        startTime: now,
        endTime: now + (durationMinutes * 60 * 1000), // Target end time
        isActive: true,
        status: 'FOCUSED', // FOCUSED, IDLE
        stats: {
            distractions: 0,
            idleTimeMs: 0,
            elapsedTimeMs: 0,
        },
        events: [] // Log of state changes
    };


state.activeSession = newSession;
    saveData();
    
    requestNotificationPermission(); // Optional
    startSessionTimers();
    updateActiveView();
    switchView('activeSession');
}

function startSessionTimers() {
    // Main Countdown Timer
    clearInterval(state.timers.countdown);
    state.timers.countdown = setInterval(tick, 1000);
    
    // Reset Idle tracking
    state.lastActivity = Date.now();
    clearInterval(state.timers.idle);
    state.timers.idle = setInterval(checkIdle, 1000);
    
    tick(); // Immediate update
}


function tick() {
    if (!state.activeSession || !state.activeSession.isActive) return;
    
    const now = Date.now();
    const remaining = state.activeSession.endTime - now;
    
    state.activeSession.stats.elapsedTimeMs = now - state.activeSession.startTime;
    
    if (remaining <= 0) {
        completeSession();
    } else {
        updateTimerDisplay(remaining);
        saveData(); // Periodic save for crash recovery
    }
}


function recoverSession() {
    const now = Date.now();
    if (now >= state.activeSession.endTime) {
        // Expired while closed
        completeSession();
    } else {
        // Resume
        startSessionTimers();
        updateActiveView();
        switchView('activeSession');
    }
}

function stopSession() {
    if (confirm('Are you sure you want to end this session early?')) {
        completeSession();
    }
}

function completeSession() {
    clearInterval(state.timers.countdown);
    clearInterval(state.timers.idle);
    
    if (!state.activeSession) return;
    
    const session = state.activeSession;
    session.isActive = false;
    session.actualEndTime = Date.now();

    session.isActive = false;
session.actualEndTime = Date.now();

// play notification sound
sessionCompleteSound.play();


// Calculate final stats
    const totalDuration = session.actualEndTime - session.startTime;
    // Cap duration if it exceeded planned (e.g. natural finish)
    // Actually, we usually just care about the focused time vs planned time.

// Calculate Score
    const score = calculateScore(session);
    session.score = score;
    
    // Archive
    state.sessions.unshift(session);
    state.activeSession = null;
    savData();
    
    renderSummary(session);
    renderHistory();
    switchView('summary');
}

// --- ACTIVITY TRACKING ---
function handleVisibilityChange() {
    if (!state.activeSession || !state.activeSession.isActive) return;
    
    if (document.hidden) {
        // User left tab
        state.activeSession.stats.distractions++;
        logEvent('DISTRACTION_START');
    } else {
        // User returned
        logEvent('DISTRACTION_END');
    }
    updateActiveView();
    saveData();
}

function resetIdleTimer() {
    if (!state.activeSession || !state.activeSession.isActive) return;

    state.lastActivity = Date.now();

    if (state.activeSession.status === 'IDLE') {
        state.activeSession.status = 'FOCUSED';
        logEvent('IDLE_END');
    }

    updateActiveView();
}

function checkIdle() {
    if (!state.activeSession || !state.activeSession.isActive) return;
    
    const now = Date.now();
    const timeSinceActivity = now - state.lastActivity;
    
    if (timeSinceActivity > state.activeSession.idleThresholdMs) {
        if (state.activeSession.status === 'FOCUSED') {
            state.activeSession.status = 'IDLE';
            logEvent('IDLE_START');
            updateActiveView();
        }
        // Accumulate idle time (approx 1s per tick)
        state.activeSession.stats.idleTimeMs += 1000;
        updateActiveView(); // Update idle display
    }
}


// --- LOGIC & HELPERS ---
function calculateScore(session) {
    const plannedDuration = session.plannedDurationMs;
    const elapsed = session.actualEndTime - session.startTime;
    
    // Base score: % of completion (if ended early, score is lower)
    // If finished naturally, it's 100% baseline.
    let completionRatio = Math.min(1, elapsed / plannedDuration);
    let baseScore = 100 * completionRatio;
    
    // Penalties
    const distractionPenalty = session.stats.distractions * 5; // -5 per distraction
    const idleSeconds = session.stats.idleTimeMs / 1000;
    const idlePenalty = (idleSeconds / 60) * 2; // -2 per idle minute
    
    let finalScore = baseScore - distractionPenalty - idlePenalty;
    return Math.max(0, Math.round(finalScore)); // Clamp at 0
}

function updateTimerDisplay(ms) {
    const seconds = Math.ceil(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    state.dom.active.timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    document.title = `${m}:${s.toString().padStart(2, '0')} - Focus Tracker`;
}

function updateActiveView() {
    if (!state.activeSession) return;
    
    const s = state.activeSession;
    state.dom.active.taskName.textContent = s.taskName;
    state.dom.active.status.textContent = s.status;
    state.dom.active.status.className = `status-badge ${s.status.toLowerCase()}`;
    
    state.dom.active.distractionCount.textContent = s.stats.distractions;
    
    const idleSecs = Math.floor(s.stats.idleTimeMs / 1000);
    const iM = Math.floor(idleSecs / 60);
    const iS = idleSecs % 60;
    state.dom.active.idleTime.textContent = `${iM}:${iS.toString().padStart(2, '0')}`;
}


function renderSummary(session) {
    state.dom.summary.score.textContent = session.score;
    state.dom.summary.task.textContent = session.taskName;
    
    const elapsedSecs = Math.floor((session.actualEndTime - session.startTime) / 1000);
    const eM = Math.floor(elapsedSecs / 60);
    state.dom.summary.duration.textContent = `${eM}m`;
    
    state.dom.summary.distractions.textContent = session.stats.distractions;
    
    const idleSecs = Math.floor(session.stats.idleTimeMs / 1000);
    state.dom.summary.idle.textContent = `${Math.floor(idleSecs / 60)}m ${idleSecs % 60}s`;
}

function renderHistory() {
    const list = state.dom.dashboard.historyList;
    list.innerHTML = '';
    
    if (state.sessions.length === 0) {
        list.innerHTML = '<li class="empty-state">No sessions yet. Start focusing!</li>';
        state.dom.dashboard.totalFocus.textContent = '0h 0m';
        state.dom.dashboard.avgScore.textContent = '-';
        return;
    }
    
    let totalMs = 0;
    let totalScore = 0;
    
    state.sessions.forEach(session => {
        const elapsed = session.actualEndTime - session.startTime;
        totalMs += elapsed;
        totalScore += session.score;
        
        const date = new Date(session.startTime).toLocaleDateString();
        const durationMins = Math.floor(elapsed / 60000);
        
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
            <div class="history-info">
                <h4>${session.taskName}</h4>
                <div class="history-meta">${date} • ${durationMins}m • ${session.stats.distractions} distractions</div>
            </div>
            <div class="score-badge">${session.score}</div>
        `;
        list.appendChild(li);
    });
    
    // Aggregate Stats
    const totalMins = Math.floor(totalMs / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    state.dom.dashboard.totalFocus.textContent = `${h}h ${m}m`;
    
    const avg = Math.round(totalScore / state.sessions.length);
    state.dom.dashboard.avgScore.textContent = avg;
}




// --- UTILS ---
function switchView(viewName) {
    state.view = viewName;
    ['dashboard', 'activeSession', 'summary'].forEach(v => {
        state.dom.views[v].classList.add('hidden');
        state.dom.views[v].classList.remove('active');
    });
    // Tiny delay to allow CSS transitions if we wanted them, 
    // but for now simple display toggling
    state.dom.views[viewName].classList.remove('hidden');
    setTimeout(() => {
        state.dom.views[viewName].classList.add('active');
    }, 10);
}

function saveData() {
    const data = {
        sessions: state.sessions,
        activeSession: state.activeSession
    };
    localStorage.setItem('focusTrackerData', JSON.stringify(data));
}

function loadData() {
    const json = localStorage.getItem('focusTrackerData');
    if (json) {
        const data = JSON.parse(json);
        state.sessions = data.sessions || [];
        state.activeSession = data.activeSession || null;
    }
}

function resetAllData() {
    if (confirm('Create slate clean? This will delete all history.')) {
        localStorage.removeItem('focusTrackerData');
        state.sessions = [];
        state.activeSession = null;
        renderHistory();
        switchView('dashboard');
    }
}



function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
}

function savData() {
    saveData();
}  


// Start App
document.addEventListener('DOMContentLoaded', init);

