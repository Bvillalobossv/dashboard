// --- Conexión a Supabase ---
const SUPABASE_URL = "https://kdxoxusimqdznduwyvhl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkeG94dXNpbXFkem5kdXd5dmhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MDc4NDgsImV4cCI6MjA3NTQ4Mzg0OH0.sfa5iISRNYwwOQLzkSstWLMAqSRUSKJHCItDkgFkQvc";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Parámetros de Lia ---
const ADMIN_LOGIN_DOMAIN = "lia.app"; // Cambia si usas otro dominio para los admins
const TEAM_FIELD = "department";       // Cambia si tu columna en 'profiles' se llama distinto

// --- Selectores y estado global ---
const screenLogin = document.getElementById("screenLogin");
const screenDashboard = document.getElementById("screenDashboard");
const formAdminLogin = document.getElementById("formAdminLogin");
const btnSignOut = document.getElementById("btnSignOut");
const loginMessage = document.getElementById("login-message");

const priorityListContainer = document.getElementById("priority-list-container");
const riskMapContainer = document.getElementById("risk-map-container");
const showAllBtn = document.getElementById("show-all-btn");

const departmentFilter = document.getElementById("department-filter");
const riskFilter = document.getElementById("risk-filter");

// Modal de detalle de equipo
const modalProfile = document.getElementById("modal-profile");
const modalCloseBtn = modalProfile.querySelector(".modal-close-btn");
const modalTitle = document.getElementById("modal-username");
const modalMeta = document.getElementById("modal-meta");
const gamificationSuggestionEl = document.getElementById("gamification-suggestion");

// Charts
let teamEvolutionChart = null;
let teamDistributionChart = null;
let riskDistributionChart = null;
let wellbeingTrendChart = null;

// Datos en memoria
let allCollaboratorsData = [];  // perfiles + mediciones por persona
let teamsData = [];             // datos agregados por equipo
let currentFilter = { department: "All", risk: "All" };

// --- Autenticación ---
formAdminLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("admin_user").value.trim();
  const password = document.getElementById("admin_pass").value;
  loginMessage.textContent = "Ingresando...";

  const email = `${username.toLowerCase()}@${ADMIN_LOGIN_DOMAIN}`;

  try {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (error) {
    console.error(error);
    loginMessage.textContent = "Usuario o contraseña incorrectos.";
  }
});

btnSignOut.addEventListener("click", () => db.auth.signOut());

db.auth.onAuthStateChange((event, session) => {
  if (session && session.user) {
    onLoggedIn();
  } else {
    onLoggedOut();
  }
});

function onLoggedIn() {
  screenLogin.classList.remove("active");
  screenDashboard.classList.add("active");
  loadDashboardData();
}

function onLoggedOut() {
  screenDashboard.classList.remove("active");
  screenLogin.classList.add("active");
}

// --- Carga principal de datos ---
async function loadDashboardData() {
  priorityListContainer.innerHTML = "<p>Cargando equipos...</p>";
  riskMapContainer.innerHTML = "<p>Calculando riesgos...</p>";

  try {
    const { data: profiles, error: profilesError } = await db
      .from("profiles")
      .select("*");

    if (profilesError) throw profilesError;

    const { data: measurements, error: measurementsError } = await db
      .from("measurements")
      .select("*");

    if (measurementsError) throw measurementsError;

    // Vincular mediciones a cada colaborador
    allCollaboratorsData = profiles.map((profile) => {
      const userMeasurements = measurements
        .filter((m) => m.user_id_uuid === profile.id)
        .sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

      return {
        ...profile,
        allMeasurements: userMeasurements,
        latestMeasurement: userMeasurements[0] || null,
      };
    });

    // Construir datos por equipo
    teamsData = buildTeamsData(allCollaboratorsData);
    buildDepartmentFilterOptions(teamsData);
    applyFiltersAndRender();
  } catch (error) {
    console.error("Error cargando datos:", error);
    priorityListContainer.innerHTML =
      '<p class="error-message">No se pudieron cargar los datos.</p>';
    riskMapContainer.innerHTML =
      '<p class="error-message">Error al calcular riesgos.</p>';
  }
}

// --- Helpers de agregación por equipo ---
function buildTeamsData(users) {
  const teamsMap = {};
  const participationWindowDays = 7;
  const now = new Date();

  users.forEach((user) => {
    const teamKey = (user[TEAM_FIELD] || "Sin equipo").trim();
    const department = user.department || "Sin área";

    if (!teamsMap[teamKey]) {
      teamsMap[teamKey] = {
        teamKey,
        teamName: teamKey,
        department,
        members: [],
      };
    }
    teamsMap[teamKey].members.push(user);
  });

  const teamsArray = Object.values(teamsMap).map((team) => {
    const members = team.members;
    const headcount = members.length;

    const latestMeasurements = members
      .map((u) => u.latestMeasurement)
      .filter(Boolean);

    let avgScore = null;
    let riskLevel = "sin-datos";
    let lastMeasurementAt = null;
    let participation = 0;

    if (latestMeasurements.length > 0) {
      const scores = latestMeasurements.map((m) => m.combined_score || 0);
      avgScore =
        scores.reduce((sum, s) => sum + s, 0) / latestMeasurements.length;

      if (avgScore < 40) riskLevel = "alto";
      else if (avgScore < 65) riskLevel = "medio";
      else riskLevel = "bajo";

      lastMeasurementAt = latestMeasurements.reduce((latest, m) => {
        const d = new Date(m.created_at);
        if (!latest || d > latest) return d;
        return latest;
      }, null);

      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - participationWindowDays);
      const activeMembers = members.filter((u) => {
        if (!u.latestMeasurement) return false;
        return new Date(u.latestMeasurement.created_at) >= cutoff;
      }).length;
      participation =
        headcount > 0 ? Math.round((activeMembers / headcount) * 100) : 0;
    }

    // Tendencia: comparamos últimas 2 ventanas de 14 días
    const TREND_WINDOW = 14;
    const allMs = members.flatMap((u) => u.allMeasurements || []);
    const cutoffRecent = new Date(now);
    cutoffRecent.setDate(cutoffRecent.getDate() - TREND_WINDOW);
    const cutoffPast = new Date(now);
    cutoffPast.setDate(cutoffPast.getDate() - 2 * TREND_WINDOW);

    const recentScores = allMs
      .filter((m) => new Date(m.created_at) >= cutoffRecent)
      .map((m) => m.combined_score || 0);

    const pastScores = allMs
      .filter(
        (m) =>
          new Date(m.created_at) >= cutoffPast &&
          new Date(m.created_at) < cutoffRecent
      )
      .map((m) => m.combined_score || 0);

    const avg = (arr) =>
      arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    const recentAvg = avg(recentScores);
    const pastAvg = avg(pastScores);

    let trendDirection = "stable";
    let trendLabel = "Sin datos suficientes";

    if (recentAvg !== null && pastAvg !== null) {
      if (recentAvg > pastAvg + 3) {
        trendDirection = "up";
        trendLabel = "Mejorando";
      } else if (recentAvg < pastAvg - 3) {
        trendDirection = "down";
        trendLabel = "Empeorando";
      } else {
        trendDirection = "stable";
        trendLabel = "Estable";
      }
    } else if (recentAvg !== null) {
      trendDirection = "stable";
      trendLabel = "Con datos recientes";
    }

    return {
      ...team,
      metrics: {
        headcount,
        avgScore,
        riskLevel,
        lastMeasurementAt,
        participation,
        trendDirection,
        trendLabel,
      },
    };
  });

  // Ordenamos equipos del mayor riesgo (score más bajo) al menor
  teamsArray.sort((a, b) => {
    const aScore = a.metrics.avgScore ?? 101;
    const bScore = b.metrics.avgScore ?? 101;
    return aScore - bScore;
  });

  return teamsArray;
}

// --- Filtros ---
function buildDepartmentFilterOptions(teams) {
  const departments = new Set(["All"]);
  teams.forEach((t) => departments.add(t.department || "Sin área"));

  departmentFilter.innerHTML = "";
  departments.forEach((dept) => {
    const option = document.createElement("option");
    option.value = dept;
    option.textContent = dept === "All" ? "Todas las áreas" : dept;
    departmentFilter.appendChild(option);
  });

  departmentFilter.value = "All";
}

departmentFilter.addEventListener("change", () => {
  currentFilter.department = departmentFilter.value;
  applyFiltersAndRender();
});

riskFilter.addEventListener("change", () => {
  currentFilter.risk = riskFilter.value;
  applyFiltersAndRender();
});

showAllBtn.addEventListener("click", () => {
  currentFilter = { department: "All", risk: "All" };
  departmentFilter.value = "All";
  riskFilter.value = "All";
  applyFiltersAndRender();
});

// --- Aplicar filtros y renderizar ---
function applyFiltersAndRender() {
  if (!teamsData || teamsData.length === 0) {
    priorityListContainer.innerHTML =
      "<p>No hay equipos con datos disponibles.</p>";
    return;
  }

  let filtered = [...teamsData];

  if (currentFilter.department !== "All") {
    filtered = filtered.filter(
      (t) => (t.department || "Sin área") === currentFilter.department
    );
  }

  if (currentFilter.risk !== "All") {
    filtered = filtered.filter(
      (t) => (t.metrics.riskLevel || "sin-datos") === currentFilter.risk
    );
  }

  if (
    currentFilter.department !== "All" ||
    currentFilter.risk !== "All"
  ) {
    showAllBtn.classList.remove("hidden");
  } else {
    showAllBtn.classList.add("hidden");
  }

  renderPriorityList(filtered);
  renderRiskMap(teamsData);
  renderGeneralReport(teamsData);
}

// --- Render de tabla de equipos ---
function renderPriorityList(teams) {
  if (!teams || teams.length === 0) {
    priorityListContainer.innerHTML =
      "<p>No hay equipos para los filtros seleccionados.</p>";
    return;
  }

  let html = `
    <table class="priority-table">
      <thead>
        <tr>
          <th>Equipo</th>
          <th>Área</th>
          <th>Personas</th>
          <th>Bienestar promedio</th>
          <th>Riesgo</th>
          <th>Participación (7 días)</th>
          <th>Tendencia</th>
        </tr>
      </thead>
      <tbody>
  `;

  teams.forEach((team) => {
    const m = team.metrics;
    const scoreLabel =
      m.avgScore !== null ? `${m.avgScore.toFixed(1)}/100` : "Sin datos";
    const riskClass =
      m.riskLevel === "alto" || m.riskLevel === "medio" || m.riskLevel === "bajo"
        ? m.riskLevel
        : "bajo";
    const riskLabel =
      m.riskLevel === "alto"
        ? "Alto"
        : m.riskLevel === "medio"
        ? "Medio"
        : m.riskLevel === "bajo"
        ? "Bajo"
        : "Sin datos";
    const participationLabel = `${m.participation ?? 0}%`;

    let trendIcon = "⟲";
    if (m.trendDirection === "up") trendIcon = "⬆";
    else if (m.trendDirection === "down") trendIcon = "⬇";

    html += `
      <tr data-team-key="${team.teamKey}">
        <td>${team.teamName}</td>
        <td>${team.department || "Sin área"}</td>
        <td>${m.headcount}</td>
        <td>${scoreLabel}</td>
        <td>
          <div class="risk-bar-container">
            <div class="risk-bar ${riskClass}" style="width: ${
      m.avgScore !== null ? Math.min(100, m.avgScore).toFixed(0) : 0
    }%;"></div>
          </div>
          <small>${riskLabel}</small>
        </td>
        <td>${participationLabel}</td>
        <td><span class="trend trend-${m.trendDirection}">${trendIcon} ${
      m.trendLabel
    }</span></td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  priorityListContainer.innerHTML = html;
}

// --- Render mapa de riesgo por área (usando equipos) ---
function renderRiskMap(teams) {
  const departments = {};

  teams.forEach((team) => {
    const dept = team.department || "Sin área";
    if (!departments[dept]) {
      departments[dept] = { scores: [], teamCount: 0 };
    }
    if (team.metrics.avgScore !== null) {
      departments[dept].scores.push(team.metrics.avgScore);
    }
    departments[dept].teamCount += 1;
  });

  const deptNames = Object.keys(departments);
  if (deptNames.length === 0) {
    riskMapContainer.innerHTML = "<p>No hay datos de áreas.</p>";
    return;
  }

  let html = "";
  deptNames.forEach((dept) => {
    const info = departments[dept];
    const avgScore =
      info.scores.length > 0
        ? info.scores.reduce((s, v) => s + v, 0) / info.scores.length
        : null;

    let riskLevel = "bajo";
    if (avgScore === null) riskLevel = "bajo";
    else if (avgScore < 40) riskLevel = "alto";
    else if (avgScore < 65) riskLevel = "medio";

    const scoreLabel =
      avgScore !== null ? `${avgScore.toFixed(1)}/100` : "Sin datos";

    html += `
      <div class="map-area risk-${riskLevel}" data-department="${dept}">
        <h4>${dept}</h4>
        <div class="score">${scoreLabel}</div>
        <p>${info.teamCount} equipo(s)</p>
      </div>
    `;
  });

  riskMapContainer.innerHTML = html;
}

// --- Reporte general ---
function renderGeneralReport(teams) {
  const riskCounts = { alto: 0, medio: 0, bajo: 0 };

  teams.forEach((team) => {
    const level = team.metrics.riskLevel;
    if (level === "alto") riskCounts.alto += 1;
    else if (level === "medio") riskCounts.medio += 1;
    else if (level === "bajo") riskCounts.bajo += 1;
  });

  const riskCtx = document
    .getElementById("risk-distribution-chart")
    .getContext("2d");
  if (riskDistributionChart) riskDistributionChart.destroy();
  riskDistributionChart = new Chart(riskCtx, {
    type: "doughnut",
    data: {
      labels: ["Equipos en riesgo alto", "Riesgo medio", "Riesgo bajo"],
      datasets: [
        {
          data: [riskCounts.alto, riskCounts.medio, riskCounts.bajo],
          backgroundColor: ["#ef4444", "#f59e0b", "#22c55e"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });

  // Tendencia global de bienestar usando todas las mediciones individuales
  const trendData = {};
  allCollaboratorsData.forEach((user) => {
    (user.allMeasurements || []).forEach((m) => {
      const dateKey = new Date(m.created_at).toISOString().split("T")[0];
      if (!trendData[dateKey]) trendData[dateKey] = [];
      trendData[dateKey].push(m.combined_score || 0);
    });
  });

  const sortedDates = Object.keys(trendData).sort(
    (a, b) => new Date(a) - new Date(b)
  );
  const labels = sortedDates.map((d) =>
    new Date(d).toLocaleDateString("es-CL")
  );
  const values = sortedDates.map((d) => {
    const arr = trendData[d];
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  });

  const wellbeingCtx = document
    .getElementById("wellbeing-trend-chart")
    .getContext("2d");
  if (wellbeingTrendChart) wellbeingTrendChart.destroy();
  wellbeingTrendChart = new Chart(wellbeingCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Bienestar promedio de la organización",
          data: values,
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100 },
      },
    },
  });
}

// --- Modal de detalle de equipo ---
priorityListContainer.addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-team-key]");
  if (!row) return;
  const teamKey = row.dataset.teamKey;
  const team = teamsData.find((t) => t.teamKey === teamKey);
  if (team) {
    openTeamModal(team);
  }
});

riskMapContainer.addEventListener("click", (e) => {
  const area = e.target.closest(".map-area");
  if (area && area.dataset.department) {
    currentFilter.department = area.dataset.department;
    departmentFilter.value = area.dataset.department;
    applyFiltersAndRender();
  }
});

modalCloseBtn.addEventListener("click", () => {
  modalProfile.classList.add("hidden");
  if (teamEvolutionChart) {
    teamEvolutionChart.destroy();
    teamEvolutionChart = null;
  }
  if (teamDistributionChart) {
    teamDistributionChart.destroy();
    teamDistributionChart = null;
  }
});

function openTeamModal(team) {
  const m = team.metrics;
  modalTitle.textContent = `Equipo: ${team.teamName}`;
  const lastDate =
    m.lastMeasurementAt instanceof Date
      ? m.lastMeasurementAt.toLocaleDateString("es-CL")
      : "Sin datos recientes";

  modalMeta.textContent = `${team.department || "Sin área"} · ${
    m.headcount
  } personas · Última medición: ${lastDate}`;

  gamificationSuggestionEl.textContent = generateTeamGamificationSuggestion(
    team
  );

  renderTeamEvolutionChart(team);
  renderTeamDistributionChart(team);

  modalProfile.classList.remove("hidden");
}

function renderTeamEvolutionChart(team) {
  const byDate = {};
  team.members.forEach((user) => {
    (user.allMeasurements || []).forEach((m) => {
      const dateKey = new Date(m.created_at).toISOString().split("T")[0];
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(m.combined_score || 0);
    });
  });

  const sortedDates = Object.keys(byDate).sort(
    (a, b) => new Date(a) - new Date(b)
  );
  const labels = sortedDates.map((d) =>
    new Date(d).toLocaleDateString("es-CL")
  );
  const values = sortedDates.map((d) => {
    const arr = byDate[d];
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  });

  const ctx = document.getElementById("team-evolution-chart").getContext("2d");
  if (teamEvolutionChart) teamEvolutionChart.destroy();
  teamEvolutionChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Bienestar promedio del equipo",
          data: values,
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100 },
      },
    },
  });
}

function renderTeamDistributionChart(team) {
  const counts = { alto: 0, medio: 0, bajo: 0, sinDatos: 0 };

  team.members.forEach((user) => {
    const m = user.latestMeasurement;
    if (!m || m.combined_score == null) {
      counts.sinDatos += 1;
      return;
    }
    const score = m.combined_score;
    if (score < 40) counts.alto += 1;
    else if (score < 65) counts.medio += 1;
    else counts.bajo += 1;
  });

  const ctx = document
    .getElementById("team-distribution-chart")
    .getContext("2d");
  if (teamDistributionChart) teamDistributionChart.destroy();
  teamDistributionChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Alto", "Medio", "Bajo", "Sin datos"],
      datasets: [
        {
          label: "Personas por nivel de riesgo",
          data: [
            counts.alto,
            counts.medio,
            counts.bajo,
            counts.sinDatos,
          ],
          backgroundColor: ["#ef4444", "#f59e0b", "#22c55e", "#94a3b8"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, precision: 0 },
      },
    },
  });
}

// --- Sugerencias de acciones para el equipo (placeholder para futura IA) ---
function generateTeamGamificationSuggestion(team) {
  const m = team.metrics;
  if (m.avgScore == null) {
    return "Todavía no hay suficientes datos para sugerir acciones para este equipo.";
  }

  if (m.riskLevel === "alto") {
    return "Equipo en riesgo alto: prioriza una conversación abierta sobre carga de trabajo y clima, define 1–2 acciones concretas (pausas activas, redistribución de tareas) y haz un seguimiento semanal.";
  }

  if (m.riskLevel === "medio") {
    if (m.trendDirection === "down") {
      return "Equipo en riesgo medio y a la baja: identifica focos de estrés (turnos, metas, comunicación) y prueba intervenciones rápidas como check-ins breves de inicio/fin de jornada.";
    }
    return "Equipo en riesgo medio: refuerza prácticas que ya funcionan (reconocimiento, flexibilidad, pausas cortas) y mide si el equipo se mueve a riesgo bajo en las próximas semanas.";
  }

  // Riesgo bajo
  return "Equipo en riesgo bajo: mantén y celebra las buenas prácticas. Puedes probar dinámicas de gamificación (desafíos de bienestar, reconocimiento entre pares) para seguir fortaleciendo el clima.";
}
