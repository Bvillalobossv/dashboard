// --- Conexión a Supabase ---
const SUPABASE_URL = "https://kdxoxusimqdznduwyvhl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkeG94dXNpbXFkem5kdXd5dmhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MDc4NDgsImV4cCI6MjA3NTQ4Mzg0OH0.sfa5iISRNYwwOQLzkSstWLMAqSRUSKJHCItDkgFkQvc";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Selectores de Elementos ---
const screenLogin = document.getElementById('screenLogin');
const screenDashboard = document.getElementById('screenDashboard');
const formAdminLogin = document.getElementById('formAdminLogin');
const btnSignOut = document.getElementById('btnSignOut');
const loginMessage = document.getElementById('login-message');
const priorityListContainer = document.getElementById('priority-list-container');
const modalProfile = document.getElementById('modal-profile');

let evolutionChart = null; // Variable global para el gráfico

// --- Lógica de Autenticación ---
formAdminLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('admin_user').value.trim();
    const password = document.getElementById('admin_pass').value;
    loginMessage.textContent = 'Ingresando...';
    const email = `${username.toLowerCase()}@raizen.app`;

    try {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
    } catch (error) {
        loginMessage.textContent = 'Usuario o contraseña incorrectos.';
    }
});

btnSignOut.addEventListener('click', () => db.auth.signOut());

db.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
        onLoggedIn(session.user);
    } else {
        onLoggedOut();
    }
});

function onLoggedIn(user) {
    screenLogin.classList.remove('active');
    screenDashboard.classList.add('active');
    fetchAndDisplayPriorityList(); 
}

function onLoggedOut() {
    screenDashboard.classList.remove('active');
    screenLogin.classList.add('active');
}

// --- FASE 2: LÓGICA DE LA LISTA PRIORITARIA ---
async function fetchAndDisplayPriorityList() {
    priorityListContainer.innerHTML = '<p>Cargando datos de colaboradores...</p>';
    try {
        const { data: profiles, error: profilesError } = await db.from('profiles').select('*');
        if (profilesError) throw profilesError;

        const { data: measurements, error: measurementsError } = await db.from('measurements').select('*');
        if (measurementsError) throw measurementsError;

        const combinedData = profiles.map(profile => {
            const userMeasurements = measurements
                .filter(m => m.user_id_uuid === profile.id)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            return { ...profile, latestMeasurement: userMeasurements[0] || null };
        });

        const processedData = combinedData.map(user => {
            let riskLevel = 'bajo';
            let riskScore = 100;
            if (user.latestMeasurement) {
                riskScore = user.latestMeasurement.combined_score;
                if (riskScore < 40) riskLevel = 'alto';
                else if (riskScore < 65) riskLevel = 'medio';
            }
            return { ...user, riskLevel, riskScore };
        }).sort((a, b) => a.riskScore - b.riskScore);

        renderPriorityList(processedData);
    } catch (error) {
        priorityListContainer.innerHTML = `<p class="error-message">No se pudieron cargar los datos.</p>`;
    }
}

function renderPriorityList(data) {
    if (data.length === 0) {
        priorityListContainer.innerHTML = '<p>No hay datos de trabajadores para mostrar.</p>';
        return;
    }
    const tableHTML = `
        <table class="priority-table">
            <thead>
                <tr>
                    <th>Nombre del Trabajador</th>
                    <th>Nivel de Riesgo</th>
                    <th>Última Actualización</th>
                    <th>Contacto</th>
                    <th>Estado de Contacto</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(user => `
                    <tr data-user-id="${user.id}" data-username="${user.username}">
                        <td>${user.username || 'Usuario sin nombre'}</td>
                        <td><div class="risk-bar-container"><div class="risk-bar ${user.riskLevel}" style="width: ${100 - user.riskScore}%"></div></div></td>
                        <td>${user.latestMeasurement ? new Date(user.latestMeasurement.created_at).toLocaleString('es-CL') : 'N/A'}</td>
                        <td class="contact-icons"><span>📞</span><span>✉️</span><span>💬</span></td>
                        <td><label class="switch"><input type="checkbox"><span class="slider round"></span></label></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    priorityListContainer.innerHTML = tableHTML;
}

// --- FASE 3: LÓGICA DEL PERFIL INDIVIDUAL ---
priorityListContainer.addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (row && row.dataset.userId) {
        openProfileModal(row.dataset.userId, row.dataset.username);
    }
});

modalProfile.querySelector('.modal-close-btn').addEventListener('click', () => {
    modalProfile.classList.add('hidden');
    if (evolutionChart) {
        evolutionChart.destroy(); // Destruir el gráfico para liberar memoria
    }
});

async function openProfileModal(userId, username) {
    document.getElementById('modal-username').textContent = `Perfil de ${username}`;
    const btnSaveNote = document.getElementById('btn-save-note');
    btnSaveNote.dataset.employeeId = userId; // Guardar el ID para usarlo al guardar la nota

    modalProfile.classList.remove('hidden');

    try {
        // Cargar mediciones para el gráfico y el historial
        const { data: measurements, error: mError } = await db.from('measurements')
            .select('created_at, combined_score, journal_entry')
            .eq('user_id_uuid', userId)
            .order('created_at', { ascending: true }); // Ascendente para el gráfico
        if (mError) throw mError;
        
        renderEvolutionChart(measurements);
        renderJournalHistory(measurements);
        
        // Cargar y mostrar las notas de RRHH
        await fetchAndRenderHrNotes(userId);

    } catch (error) {
        console.error("Error al cargar datos del perfil:", error);
    }
}

function renderEvolutionChart(measurements) {
    const ctx = document.getElementById('evolution-chart').getContext('2d');
    const labels = measurements.map(m => new Date(m.created_at).toLocaleDateString('es-CL'));
    const data = measurements.map(m => m.combined_score);

    if (evolutionChart) {
        evolutionChart.destroy();
    }

    evolutionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Índice de Equilibrio',
                data: data,
                borderColor: 'var(--primary-blue)',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: { scales: { y: { beginAtZero: true, max: 100 } } }
    });
}

function renderJournalHistory(measurements) {
    const container = document.getElementById('journal-history');
    const validEntries = measurements.filter(m => m.journal_entry).reverse(); // Invertir para mostrar lo más nuevo primero
    
    if(validEntries.length === 0) {
        container.innerHTML = '<p class="placeholder-text">Sin entradas en el diario.</p>';
        return;
    }
    
    container.innerHTML = validEntries.map(m => `
        <div class="history-item">
            <strong>${new Date(m.created_at).toLocaleString('es-CL')}</strong>
            <p>"${m.journal_entry}"</p>
        </div>
    `).join('');
}

async function fetchAndRenderHrNotes(employeeId) {
    const container = document.getElementById('hr-notes-history');
    try {
        const { data: notes, error } = await db.from('hr_notes')
            .select('*, admin:admin_id(profiles(username))') // Asumimos que los admins también tienen perfil
            .eq('employee_id', employeeId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if(notes.length === 0) {
            container.innerHTML = '<p class="placeholder-text">Sin notas para este colaborador.</p>';
            return;
        }

        container.innerHTML = notes.map(n => `
            <div class="history-item">
                <strong>${new Date(n.created_at).toLocaleString('es-CL')}</strong>
                <p>${n.note_text}</p>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<p class="error-message">No se pudieron cargar las notas.</p>';
    }
}

document.getElementById('btn-save-note').addEventListener('click', async (e) => {
    const employeeId = e.target.dataset.employeeId;
    const noteText = document.getElementById('hr-new-note').value.trim();
    const { data: { user } } = await db.auth.getUser();

    if (!noteText || !employeeId || !user) return;
    
    try {
        const { error } = await db.from('hr_notes').insert({
            employee_id: employeeId,
            admin_id: user.id,
            note_text: noteText
        });
        if (error) throw error;

        document.getElementById('hr-new-note').value = ''; // Limpiar el textarea
        await fetchAndRenderHrNotes(employeeId); // Recargar las notas
    } catch (error) {
        console.error("Error al guardar la nota:", error);
        alert("No se pudo guardar la nota.");
    }
});