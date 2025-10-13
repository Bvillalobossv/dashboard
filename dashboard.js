// ===================== CONEXIÓN A SUAPBASE =====================
const SUPABASE_URL = 'https://kdxoxusimqdznduwyvhl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkeG94dXNpbXFkem5kdXd5dmhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MDc4NDgsImV4cCI6MjA3NTQ4Mzg0OH0.sfa5iISRNYwwOQLzkSstWLMAqSRUSKJHCItDkgFkQvc';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== ELEMENTOS DEL DOM =====================
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');
const logoutButton = document.getElementById('logout-button');
const userDisplay = document.getElementById('user-display');
const loadingMessage = document.getElementById('loading-message');
const dashboardContent = document.getElementById('dashboard-content');

// Elementos del Dashboard
const generalScoreEl = document.getElementById('general-score');
const activeUsersEl = document.getElementById('active-users');
const avgNoiseEl = document.getElementById('avg-noise');
const avgTensionEl = document.getElementById('avg-tension');
const trendChartCanvas = document.getElementById('trend-chart');
const priorityListBody = document.getElementById('priority-list-body');
const departmentFilter = document.getElementById('department-filter');

let trendChart = null;

// ===================== LÓGICA DE AUTENTICACIÓN =====================
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    loginMessage.textContent = 'Ingresando...';
    loginMessage.className = 'message';

    const email = `${username.toLowerCase().replace(/[^a-z0-9]/gi, '')}@example.com`;

    const { data, error } = await db.auth.signInWithPassword({ 
        email: email, 
        password: password 
    });

    if (error) {
        loginMessage.textContent = 'Error: Usuario o contraseña incorrectos.';
        loginMessage.className = 'message error';
    }
    // El resto de la lógica la maneja onAuthStateChange
});

logoutButton.addEventListener('click', async () => {
    await db.auth.signOut();
});

function showLogin() {
    loginScreen.classList.add('active');
    dashboardScreen.classList.remove('active');
}

async function showDashboard(user) {
    // Mostramos el nombre de usuario real en el header
    const { data: profile } = await db.from('profiles').select('username').eq('id', user.id).single();
    userDisplay.textContent = profile ? profile.username : user.email;

    loginScreen.classList.remove('active');
    dashboardScreen.classList.add('active');
    await loadDashboardData();
}

// --> CAMBIO: La lógica de verificación de admin ahora está aquí.
db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
        // 1. Cuando el usuario inicia sesión, PRIMERO verificamos su rol.
        const { data: profile, error } = await db.from('profiles').select('role').eq('id', session.user.id).single();

        if (error || !profile) {
            console.error('Error fetching profile:', error);
            await db.auth.signOut(); // Desloguear si hay error
            loginMessage.textContent = 'Error al verificar perfil.';
            loginMessage.className = 'message error';
            return;
        }

        // 2. SOLO si el rol es 'admin', mostramos el dashboard.
        if (profile.role === 'admin') {
            showDashboard(session.user);
        } else {
            // 3. Si no es admin, lo deslogueamos y mostramos un error claro.
            await db.auth.signOut();
            loginMessage.textContent = 'Error: No tienes permisos de administrador.';
            loginMessage.className = 'message error';
        }
    } else if (event === 'SIGNED_OUT') {
        showLogin();
    }
});


// Comprobar si ya hay una sesión activa al cargar la página
async function checkInitialSession() {
    const { data: { session } } = await db.auth.getSession();
    if (session) {
         const { data: profile } = await db.from('profiles').select('role').eq('id', session.user.id).single();
         if (profile && profile.role === 'admin') {
            showDashboard(session.user);
         } else {
            await db.auth.signOut();
            showLogin();
         }
    } else {
        showLogin();
    }
}
checkInitialSession();


// ===================== LÓGICA DEL DASHBOARD =====================

async function loadDashboardData() {
    loadingMessage.style.display = 'block';
    dashboardContent.style.display = 'none';

    const { data: profiles, error: profilesError } = await db.from('profiles').select('*');
    const { data: measurements, error: measurementsError } = await db.from('measurements').select('*');

    if (profilesError || measurementsError) {
        console.error('Error al cargar datos:', profilesError || measurementsError);
        loadingMessage.textContent = 'Error: No se pudieron cargar los datos. Verifica tus políticas RLS.';
        return;
    }

    loadingMessage.style.display = 'none';
    dashboardContent.style.display = 'grid';
    
    const combinedData = measurements.map(m => {
        const profile = profiles.find(p => p.id === m.user_id);
        return {
            ...m,
            username: profile ? profile.username : 'Desconocido',
            department: profile ? profile.department : 'Sin Depto.'
        };
    });

    renderSummaryCards(combinedData, profiles);
    renderTrendChart(combinedData);
    renderPriorityList(combinedData);
    populateDepartmentFilter(profiles);

    departmentFilter.onchange = () => renderPriorityList(combinedData);
}

function renderSummaryCards(data, profiles) {
    if (data.length === 0) {
        generalScoreEl.textContent = 'N/A';
        activeUsersEl.textContent = '0';
        avgNoiseEl.textContent = 'N/A';
        avgTensionEl.textContent = 'N/A';
        return;
    };
    const totalScore = data.reduce((sum, m) => sum + m.combined_score, 0);
    const avgScore = totalScore / data.length;
    generalScoreEl.textContent = `${Math.round(avgScore)}`;
    const scoreColor = getRiskColor(100 - avgScore);
    generalScoreEl.style.background = scoreColor;

    const today = new Date().toISOString().slice(0, 10);
    const activeIds = new Set(data.filter(m => m.created_at.slice(0, 10) === today).map(m => m.user_id));
    activeUsersEl.textContent = activeIds.size;

    const avgNoise = data.reduce((sum, m) => sum + m.noise_db, 0) / data.length;
    const avgTension = data.reduce((sum, m) => sum + m.body_scan_avg, 0) / data.length;
    avgNoiseEl.textContent = `${Math.round(avgNoise)} dB`;
    avgTensionEl.textContent = `${avgTension.toFixed(1)} / 10`;
}

function renderTrendChart(data) {
    if (data.length === 0) return;
    const scoresByDay = data.reduce((acc, m) => {
        const day = m.created_at.slice(0, 10);
        if (!acc[day]) acc[day] = [];
        acc[day].push(m.combined_score);
        return acc;
    }, {});

    const chartLabels = Object.keys(scoresByDay).sort();
    const chartData = chartLabels.map(day => {
        const scores = scoresByDay[day];
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
    });

    if (trendChart) trendChart.destroy();
    trendChart = new Chart(trendChartCanvas, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Índice de Bienestar Promedio',
                data: chartData,
                borderColor: 'rgba(0, 123, 255, 1)',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                fill: true,
                tension: 0.3,
            }]
        },
        options: {
            scales: {
                y: { min: 0, max: 100 },
                x: { type: 'time', time: { unit: 'day' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderPriorityList(data) {
    if (!data) return;
    const latestMeasurements = Object.values(data.reduce((acc, m) => {
        if (!acc[m.user_id] || new Date(m.created_at) > new Date(acc[m.user_id].created_at)) {
            acc[m.user_id] = m;
        }
        return acc;
    }, {}));
    latestMeasurements.sort((a, b) => a.combined_score - b.combined_score);
    
    const selectedDepartment = departmentFilter.value;
    const filteredList = selectedDepartment === 'all'
        ? latestMeasurements
        : latestMeasurements.filter(m => m.department === selectedDepartment);

    priorityListBody.innerHTML = '';
    if (filteredList.length === 0) {
        priorityListBody.innerHTML = `<tr><td colspan="3">No hay datos para mostrar.</td></tr>`;
        return;
    }
    
    filteredList.forEach(m => {
        const riskScore = 100 - m.combined_score;
        const riskColorClass = getRiskColorClass(riskScore);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${m.username}</td>
            <td>
                <div class="risk-bar">
                    <div class="risk-bar-fill ${riskColorClass}" style="width: ${riskScore}%;"></div>
                </div>
            </td>
            <td>${new Date(m.created_at).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        `;
        priorityListBody.appendChild(row);
    });
}

function populateDepartmentFilter(profiles) {
    const departments = [...new Set(profiles.map(p => p.department).filter(Boolean))];
    departmentFilter.innerHTML = '<option value="all">Todos los Departamentos</option>';
    departments.sort().forEach(dep => {
        const option = document.createElement('option');
        option.value = dep;
        option.textContent = dep;
        departmentFilter.appendChild(option);
    });
}

function getRiskColor(riskScore) {
    if (riskScore > 66) return 'var(--risk-high)';
    if (riskScore > 33) return 'var(--risk-medium)';
    return 'var(--risk-low)';
}
function getRiskColorClass(riskScore) {
    if (riskScore > 66) return 'risk-high';
    if (riskScore > 33) return 'risk-medium';
    return 'risk-low';
}

