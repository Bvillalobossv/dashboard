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

// --- Lógica de Autenticación ---
formAdminLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('admin_user').value;
    const password = document.getElementById('admin_pass').value;
    loginMessage.textContent = 'Ingresando...';

    try {
        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
    } catch (error) {
        console.error('Error de login:', error.message);
        loginMessage.textContent = 'Correo o contraseña incorrectos.';
    }
});

btnSignOut.addEventListener('click', async () => {
    await db.auth.signOut();
});

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
    // FASE 2: Llamamos a la función para cargar la lista de trabajadores.
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
        // 1. Obtener todos los perfiles y todas las mediciones.
        const { data: profiles, error: profilesError } = await db.from('profiles').select('*');
        if (profilesError) throw profilesError;

        const { data: measurements, error: measurementsError } = await db.from('measurements').select('*');
        if (measurementsError) throw measurementsError;

        // 2. Procesar los datos para combinar perfiles con su última medición.
        const combinedData = profiles.map(profile => {
            const userMeasurements = measurements
                .filter(m => m.user_id_uuid === profile.id)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // Ordenar por fecha descendente

            const latestMeasurement = userMeasurements[0] || null;

            return {
                ...profile,
                latestMeasurement
            };
        });

        // 3. Calcular nivel de riesgo y ordenar la lista.
        const processedData = combinedData.map(user => {
            let riskLevel = 'bajo';
            let riskScore = 100; // Por defecto, si no hay medición.
            if (user.latestMeasurement) {
                riskScore = user.latestMeasurement.combined_score;
                if (riskScore < 40) riskLevel = 'alto';
                else if (riskScore < 65) riskLevel = 'medio';
            }
            return { ...user, riskLevel, riskScore };
        }).sort((a, b) => a.riskScore - b.riskScore); // Ordenar por puntaje ascendente (menor es más riesgo)

        // 4. Generar el HTML de la tabla.
        renderPriorityList(processedData);

    } catch (error) {
        console.error("Error al cargar la lista de trabajadores:", error);
        priorityListContainer.innerHTML = `<p class="error-message">No se pudieron cargar los datos. Error: ${error.message}</p>`;
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
                    <tr data-user-id="${user.id}">
                        <td>${user.username || 'Usuario sin nombre'}</td>
                        <td>
                            <div class="risk-bar-container">
                                <div class="risk-bar ${user.riskLevel}" style="width: ${100 - user.riskScore}%"></div>
                            </div>
                        </td>
                        <td>${user.latestMeasurement ? new Date(user.latestMeasurement.created_at).toLocaleString('es-CL') : 'N/A'}</td>
                        <td class="contact-icons">
                            <span>📞</span>
                            <span>✉️</span>
                            <span>💬</span>
                        </td>
                        <td>
                            <label class="switch">
                                <input type="checkbox">
                                <span class="slider round"></span>
                            </label>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    priorityListContainer.innerHTML = tableHTML;
}