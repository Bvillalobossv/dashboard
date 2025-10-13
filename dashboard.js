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
const userEmailDisplay = document.getElementById('user-email');

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
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    loginMessage.textContent = 'Ingresando...';
    loginMessage.className = 'message';
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
        loginMessage.textContent = 'Error: Correo o contraseña incorrectos.';
        loginMessage.className = 'message error';
    }
});

logoutButton.addEventListener('click', async () => {
    await db.auth.signOut();
});

function showLogin() {
    loginScreen.classList.add('active');
    dashboardScreen.classList.remove('active');
}

async function showDashboard(user) {
    userEmailDisplay.textContent = user.email;
    loginScreen.classList.remove('active');
    dashboardScreen.classList.add('active');
    await loadDashboardData();
}

db.auth.onAuthStateChange((event, session) => {
    if (session) {
        showDashboard(session.user);
    } else {
        showLogin();
    }
});

// ===================== LÓGICA DEL DASHBOARD =====================

async function loadDashboardData() {
    // 1. Obtener todos los perfiles y mediciones
    const { data: profiles, error: profilesError } = await db.from('profiles').select('*');
    const { data: measurements, error: measurementsError } = await db.from('measurements').select('*');

    if (profilesError || measurementsError) {
        console.error('Error al cargar datos:', profilesError || measurementsError);
        return;
    }

    // 2. Combinar los datos
    const combinedData = measurements.map(m => {
        const profile = profiles.find(p => p.id === m.user_id);
        return {
            ...m,
            username: profile ? profile.username : 'Desconocido',
            department: profile ? profile.department : 'Sin Depto.'
        };
    });

    // 3. Renderizar todos los componentes
    renderSummaryCards(combinedData, profiles);
    renderTrendChart(combinedData);
    renderPriorityList(combinedData);
    populateDepartmentFilter(profiles);

    // 4. Añadir listener para el filtro
    departmentFilter.onchange = () => renderPriorityList(combinedData);
}

function renderSummaryCards(data, profiles) {
    if (data.length === 0) return;

    // Índice General
    const totalScore = data.reduce((sum, m) => sum + m.combined_score, 0);
    const avgScore = totalScore / data.length;
    generalScoreEl.textContent = `${Math.round(avgScore)}%`;
    const scoreColor = getRiskColor(100 - avgScore); // Invertimos el score para el color
    generalScoreEl.style.background = `linear-gradient(135deg, ${scoreColor}, ${shadeColor(scoreColor, -20)})`;

    // Colaboradores Activos
    const today = new Date().toISOString().slice(0, 10);
    const activeIds = new Set(data.filter(m => m.created_at.slice(0, 10) === today).map(m => m.user_id));
    activeUsersEl.textContent = activeIds.size;

    // Ruido y Tensión
    const avgNoise = data.reduce((sum, m) => sum + m.noise_db, 0) / data.length;
    const avgTension = data.reduce((sum, m) => sum + m.body_scan_avg, 0) / data.length;
    avgNoiseEl.textContent = `${Math.round(avgNoise)} dB`;
    avgTensionEl.textContent = `${avgTension.toFixed(1)} / 10`;
}

function renderTrendChart(data) {
    if (data.length === 0) return;

    // Agrupar scores por día
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
                borderColor: var(--primary-color),
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
    // Agrupar por usuario y obtener la última medición de cada uno
    const latestMeasurements = Object.values(data.reduce((acc, m) => {
        if (!acc[m.user_id] || new Date(m.created_at) > new Date(acc[m.user_id].created_at)) {
            acc[m.user_id] = m;
        }
        return acc;
    }, {}));

    // Ordenar por nivel de riesgo (score más bajo primero)
    latestMeasurements.sort((a, b) => a.combined_score - b.combined_score);
    
    // Filtrar por departamento
    const selectedDepartment = departmentFilter.value;
    const filteredList = selectedDepartment === 'all'
        ? latestMeasurements
        : latestMeasurements.filter(m => m.department === selectedDepartment);

    // Renderizar
    priorityListBody.innerHTML = '';
    if (filteredList.length === 0) {
        priorityListBody.innerHTML = `<tr><td colspan="3">No hay datos para el departamento seleccionado.</td></tr>`;
        return;
    }
    
    filteredList.forEach(m => {
        const riskScore = 100 - m.combined_score;
        const riskColor = getRiskColor(riskScore);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${m.username}</td>
            <td>
                <div class="risk-bar">
                    <div class="risk-bar-fill" style="width: ${riskScore}%; background-color: ${riskColor};"></div>
                </div>
            </td>
            <td>${new Date(m.created_at).toLocaleString('es-CL')}</td>
        `;
        priorityListBody.appendChild(row);
    });
}

function populateDepartmentFilter(profiles) {
    const departments = [...new Set(profiles.map(p => p.department).filter(Boolean))];
    departmentFilter.innerHTML = '<option value="all">Todos los Departamentos</option>';
    departments.forEach(dep => {
        const option = document.createElement('option');
        option.value = dep;
        option.textContent = dep;
        departmentFilter.appendChild(option);
    });
}

// --- Funciones de Utilidad ---
function getRiskColor(riskScore) {
    if (riskScore > 66) return 'var(--risk-high)';
    if (riskScore > 33) return 'var(--risk-medium)';
    return 'var(--risk-low)';
}
function shadeColor(color, percent) {
    color = color.replace('var(','').replace(')','');
    if (color.startsWith('--')) {
        color = getComputedStyle(document.documentElement).getPropertyValue(color).trim();
    }
    let R = parseInt(color.substring(1,3),16);
    let G = parseInt(color.substring(3,5),16);
    let B = parseInt(color.substring(5,7),16);
    R = parseInt(R * (100 + percent) / 100);
    G = parseInt(G * (100 + percent) / 100);
    B = parseInt(B * (100 + percent) / 100);
    R = (R<255)?R:255;  
    G = (G<255)?G:255;  
    B = (B<255)?B:255;  
    const RR = ((R.toString(16).length==1)?"0"+R.toString(16):R.toString(16));
    const GG = ((G.toString(16).length==1)?"0"+G.toString(16):G.toString(16));
    const BB = ((B.toString(16).length==1)?"0"+B.toString(16):B.toString(16));
    return "#"+RR+GG+BB;
}

