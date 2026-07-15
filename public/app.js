(function () {
  "use strict";

  const uid = () => Math.random().toString(36).slice(2, 10);

  const state = {
    active: "personal",
    error: "",
    skillInput: "",
    loading: {}, // key -> bool
    data: {
      personal: {
        name: "Jordan Avery",
        title: "Product Designer",
        email: "jordan.avery@email.com",
        phone: "(555) 012-3456",
        location: "Austin, TX",
        linkedin: "linkedin.com/in/jordanavery",
        website: "jordanavery.design",
      },
      summary:
        "Product designer with 5+ years shaping consumer web and mobile experiences, from early discovery through shipped, measurable outcomes.",
      experience: [
        {
          id: uid(),
          company: "Northlight Studio",
          role: "Senior Product Designer",
          location: "Austin, TX",
          start: "2022",
          end: "Present",
          bulletsText:
            "Led redesign of core onboarding flow, improving activation by 18%\nPartnered with PM and engineering to ship 12 features across 3 product lines\nMentored two junior designers and ran the team's weekly critique",
        },
      ],
      education: [
        {
          id: uid(),
          school: "University of Texas at Austin",
          degree: "B.F.A.",
          field: "Design",
          start: "2015",
          end: "2019",
          extra: "",
        },
      ],
      skills: ["Figma", "Design Systems", "User Research", "Prototyping", "HTML/CSS"],
      projects: [
        {
          id: uid(),
          name: "Ledger — personal finance app",
          description:
            "Designed and prototyped a budgeting app concept from research through hi-fi prototype; presented at a regional design meetup.",
          link: "",
        },
      ],
    },
  };

  const SECTIONS = [
    { key: "personal", label: "Contact" },
    { key: "summary", label: "Summary" },
    { key: "experience", label: "Experience" },
    { key: "education", label: "Education" },
    { key: "skills", label: "Skills" },
    { key: "projects", label: "Projects" },
  ];

  const tabsEl = document.getElementById("tabs");
  const formBodyEl = document.getElementById("formBody");
  const sheetEl = document.getElementById("sheet");
  const downloadBtn = document.getElementById("downloadBtn");

  downloadBtn.addEventListener("click", () => window.print());

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function setLoading(key, val) {
    state.loading[key] = val;
    renderForm();
  }

  // ---- Streaming call to our own backend (never touches the AI key) ----
  async function streamEnhance(task, fields, onDelta) {
    const res = await fetch("/api/enhance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, fields }),
    });

    if (!res.ok || !res.body) {
      throw new Error("Request failed");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop();

      for (const raw of events) {
        const lines = raw.split("\n");
        let eventType = "message";
        let dataStr = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          if (line.startsWith("data: ")) dataStr = line.slice(6);
        }
        if (!dataStr) continue;
        let payload;
        try {
          payload = JSON.parse(dataStr);
        } catch (_) {
          continue;
        }
        if (eventType === "delta" && payload.text) {
          onDelta(payload.text);
        } else if (eventType === "error") {
          throw new Error(payload.message || "AI error");
        } else if (eventType === "done") {
          return;
        }
      }
    }
  }

  async function runAi(key, task, fields, onDelta, onStart) {
    state.error = "";
    setLoading(key, true);
    if (onStart) onStart();
    try {
      await streamEnhance(task, fields, onDelta);
    } catch (e) {
      state.error = "AI request failed. Please try again.";
    } finally {
      setLoading(key, false);
      renderPreview();
    }
  }

  function polishSummary() {
    const experienceText = state.data.experience
      .map((e) => `${e.role} at ${e.company}: ${e.bulletsText}`)
      .join(" | ");
    const fields = {
      title: state.data.personal.title,
      summary: state.data.summary,
      experienceText,
      skills: state.data.skills.join(", "),
    };
    const startedFresh = !state.data.summary.trim();
    if (startedFresh) state.data.summary = "";
    runAi(
      "summary",
      "summary",
      fields,
      (chunk) => {
        state.data.summary += chunk;
        renderPreview();
        const ta = document.getElementById("f-summary");
        if (ta) ta.value = state.data.summary;
      },
      () => {
        state.data.summary = "";
      }
    );
  }

  function polishBullets(exp) {
    const fields = { role: exp.role, company: exp.company, bulletsText: exp.bulletsText };
    exp.bulletsText = "";
    runAi(`exp-${exp.id}`, "bullets", fields, (chunk) => {
      exp.bulletsText += chunk;
      renderPreview();
      const ta = document.getElementById(`exp-bullets-${exp.id}`);
      if (ta) ta.value = exp.bulletsText;
    });
  }

  function polishProject(proj) {
    const fields = { name: proj.name, description: proj.description };
    proj.description = "";
    runAi(`proj-${proj.id}`, "project", fields, (chunk) => {
      proj.description += chunk;
      renderPreview();
      const ta = document.getElementById(`proj-desc-${proj.id}`);
      if (ta) ta.value = proj.description;
    });
  }

  // ---------------- Rendering ----------------

  function renderTabs() {
    tabsEl.innerHTML = SECTIONS.map(
      (s) =>
        `<button type="button" class="tab ${state.active === s.key ? "active" : ""}" data-key="${s.key}">${s.label}</button>`
    ).join("");
    tabsEl.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.active = btn.dataset.key;
        renderForm();
      });
    });
  }

  function aiButtonHtml(key, label) {
    const isLoading = !!state.loading[key];
    return `<button type="button" class="ai-btn" data-ai="${key}" ${isLoading ? "disabled" : ""}>
      ${isLoading ? '<span class="spinner"></span> Working...' : `&#10024; ${esc(label)}`}
    </button>`;
  }

  function renderForm() {
    renderTabs();
    const d = state.data;
    let html = "";

    if (state.error) {
      html += `<div class="error-banner">${esc(state.error)}</div>`;
    }

    if (state.active === "personal") {
      html += field("Full name", input("p-name", d.personal.name));
      html += field("Job title", input("p-title", d.personal.title));
      html += `<div class="row2">${field("Email", input("p-email", d.personal.email))}${field("Phone", input("p-phone", d.personal.phone))}</div>`;
      html += field("Location", input("p-location", d.personal.location));
      html += `<div class="row2">${field("LinkedIn", input("p-linkedin", d.personal.linkedin))}${field("Website", input("p-website", d.personal.website))}</div>`;
    }

    if (state.active === "summary") {
      html += aiButtonHtml("summary", d.summary.trim() ? "Polish with AI" : "Generate from experience");
      html += field("Professional summary", textarea("f-summary", d.summary, 6));
    }

    if (state.active === "experience") {
      d.experience.forEach((exp) => {
        html += `<div class="item-card">
          <div class="item-head">
            <span class="item-title">Experience</span>
            <button type="button" class="icon-btn" data-remove="experience:${exp.id}">Remove</button>
          </div>
          <div class="row2">${field("Company", input(`exp-company-${exp.id}`, exp.company))}${field("Role", input(`exp-role-${exp.id}`, exp.role))}</div>
          <div class="row2">${field("Location", input(`exp-location-${exp.id}`, exp.location))}${field("Start", input(`exp-start-${exp.id}`, exp.start))}${field("End", input(`exp-end-${exp.id}`, exp.end))}</div>
          ${aiButtonHtml(`exp-${exp.id}`, "Improve bullets")}
          ${field("Bullet points (one per line)", textarea(`exp-bullets-${exp.id}`, exp.bulletsText, 4))}
        </div>`;
      });
      html += `<button type="button" class="add-btn" data-add="experience">+ Add experience</button>`;
    }

    if (state.active === "education") {
      d.education.forEach((edu) => {
        html += `<div class="item-card">
          <div class="item-head">
            <span class="item-title">Education</span>
            <button type="button" class="icon-btn" data-remove="education:${edu.id}">Remove</button>
          </div>
          ${field("School", input(`edu-school-${edu.id}`, edu.school))}
          <div class="row2">${field("Degree", input(`edu-degree-${edu.id}`, edu.degree))}${field("Field of study", input(`edu-field-${edu.id}`, edu.field))}</div>
          <div class="row2">${field("Start", input(`edu-start-${edu.id}`, edu.start))}${field("End", input(`edu-end-${edu.id}`, edu.end))}</div>
          ${field("Notes (GPA, honors)", input(`edu-extra-${edu.id}`, edu.extra))}
        </div>`;
      });
      html += `<button type="button" class="add-btn" data-add="education">+ Add education</button>`;
    }

    if (state.active === "skills") {
      html += `<p class="hint">Type a skill and press Enter to add it.</p>
        <div class="skill-input-row">
          <input id="skillInput" type="text" placeholder="e.g. Project Management" value="${esc(state.skillInput)}" />
          <button type="button" class="skill-add" id="skillAddBtn">Add</button>
        </div>
        <div class="chip-list">
          ${d.skills.map((s) => `<span class="chip">${esc(s)}<button type="button" data-remove-skill="${esc(s)}">&times;</button></span>`).join("")}
        </div>`;
    }

    if (state.active === "projects") {
      d.projects.forEach((proj) => {
        html += `<div class="item-card">
          <div class="item-head">
            <span class="item-title">Project</span>
            <button type="button" class="icon-btn" data-remove="projects:${proj.id}">Remove</button>
          </div>
          ${field("Project name", input(`proj-name-${proj.id}`, proj.name))}
          ${field("Link (optional)", input(`proj-link-${proj.id}`, proj.link))}
          ${aiButtonHtml(`proj-${proj.id}`, "Tighten description")}
          ${field("Description", textarea(`proj-desc-${proj.id}`, proj.description, 3))}
        </div>`;
      });
      html += `<button type="button" class="add-btn" data-add="projects">+ Add project</button>`;
    }

    formBodyEl.innerHTML = html;
    bindFormEvents();
  }

  function field(label, inner) {
    return `<label class="field"><span class="field-label">${esc(label)}</span>${inner}</label>`;
  }
  function input(id, value) {
    return `<input id="${id}" type="text" value="${esc(value)}" data-field="${id}" />`;
  }
  function textarea(id, value, rows) {
    return `<textarea id="${id}" rows="${rows}" data-field="${id}">${esc(value)}</textarea>`;
  }

  function bindFormEvents() {
    const d = state.data;

    // text inputs / textareas -> live update state + preview
    formBodyEl.querySelectorAll("input[data-field], textarea[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        applyFieldChange(el.id, el.value);
        renderPreview();
      });
    });

    formBodyEl.querySelectorAll("[data-ai]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.ai;
        if (key === "summary") return polishSummary();
        if (key.startsWith("exp-")) {
          const exp = d.experience.find((e) => `exp-${e.id}` === key);
          if (exp) polishBullets(exp);
        }
        if (key.startsWith("proj-")) {
          const proj = d.projects.find((p) => `proj-${p.id}` === key);
          if (proj) polishProject(proj);
        }
      });
    });

    formBodyEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [list, id] = btn.dataset.remove.split(":");
        d[list] = d[list].filter((item) => item.id !== id);
        renderForm();
        renderPreview();
      });
    });

    formBodyEl.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const list = btn.dataset.add;
        if (list === "experience") {
          d.experience.push({ id: uid(), company: "", role: "", location: "", start: "", end: "", bulletsText: "" });
        } else if (list === "education") {
          d.education.push({ id: uid(), school: "", degree: "", field: "", start: "", end: "", extra: "" });
        } else if (list === "projects") {
          d.projects.push({ id: uid(), name: "", description: "", link: "" });
        }
        renderForm();
        renderPreview();
      });
    });

    formBodyEl.querySelectorAll("[data-remove-skill]").forEach((btn) => {
      btn.addEventListener("click", () => {
        d.skills = d.skills.filter((s) => s !== btn.dataset.removeSkill);
        renderForm();
        renderPreview();
      });
    });

    const skillInputEl = document.getElementById("skillInput");
    const skillAddBtn = document.getElementById("skillAddBtn");
    if (skillInputEl) {
      skillInputEl.addEventListener("input", () => (state.skillInput = skillInputEl.value));
      skillInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addSkill();
        }
      });
    }
    if (skillAddBtn) skillAddBtn.addEventListener("click", addSkill);
  }

  function addSkill() {
    const s = state.skillInput.trim();
    if (s && !state.data.skills.includes(s)) {
      state.data.skills.push(s);
    }
    state.skillInput = "";
    renderForm();
    renderPreview();
  }

  function applyFieldChange(id, value) {
    const d = state.data;
    const map = {
      "p-name": () => (d.personal.name = value),
      "p-title": () => (d.personal.title = value),
      "p-email": () => (d.personal.email = value),
      "p-phone": () => (d.personal.phone = value),
      "p-location": () => (d.personal.location = value),
      "p-linkedin": () => (d.personal.linkedin = value),
      "p-website": () => (d.personal.website = value),
      "f-summary": () => (d.summary = value),
    };
    if (map[id]) return map[id]();

    const match = (prefix, list, prop) => {
      if (!id.startsWith(prefix)) return false;
      const itemId = id.slice(prefix.length);
      const item = list.find((x) => x.id === itemId);
      if (item) item[prop] = value;
      return true;
    };

    if (match("exp-company-", d.experience, "company")) return;
    if (match("exp-role-", d.experience, "role")) return;
    if (match("exp-location-", d.experience, "location")) return;
    if (match("exp-start-", d.experience, "start")) return;
    if (match("exp-end-", d.experience, "end")) return;
    if (match("exp-bullets-", d.experience, "bulletsText")) return;

    if (match("edu-school-", d.education, "school")) return;
    if (match("edu-degree-", d.education, "degree")) return;
    if (match("edu-field-", d.education, "field")) return;
    if (match("edu-start-", d.education, "start")) return;
    if (match("edu-end-", d.education, "end")) return;
    if (match("edu-extra-", d.education, "extra")) return;

    if (match("proj-name-", d.projects, "name")) return;
    if (match("proj-link-", d.projects, "link")) return;
    if (match("proj-desc-", d.projects, "description")) return;
  }

  function renderPreview() {
    const d = state.data;
    const p = d.personal;

    const contacts = [
      p.email && `<span>${esc(p.email)}</span>`,
      p.phone && `<span>${esc(p.phone)}</span>`,
      p.location && `<span>${esc(p.location)}</span>`,
      p.linkedin && `<span>${esc(p.linkedin)}</span>`,
      p.website && `<span>${esc(p.website)}</span>`,
    ]
      .filter(Boolean)
      .join("");

    let html = `<h1 class="r-name">${esc(p.name) || "Your Name"}</h1>`;
    if (p.title) html += `<p class="r-role-title">${esc(p.title)}</p>`;
    html += `<div class="r-contacts">${contacts}</div><hr class="r-hr" />`;

    if (d.summary.trim()) {
      html += `<div class="r-section"><div class="r-section-title">Summary</div><p class="r-summary">${esc(d.summary)}</p></div>`;
    }

    if (d.experience.length) {
      html += `<div class="r-section"><div class="r-section-title">Experience</div>`;
      d.experience.forEach((exp) => {
        const bullets = exp.bulletsText
          .split("\n")
          .map((b) => b.replace(/^[-•]\s*/, "").trim())
          .filter(Boolean);
        html += `<div class="r-exp-item">
          <div class="r-exp-head">
            <span class="r-role">${esc(exp.role) || "Role"}${exp.company ? ", " + esc(exp.company) : ""}</span>
            <span class="r-dates">${[exp.start, exp.end].filter(Boolean).map(esc).join(" – ")}</span>
          </div>
          ${exp.location ? `<span class="r-company">${esc(exp.location)}</span>` : ""}
          ${bullets.length ? `<ul class="r-bullets">${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
        </div>`;
      });
      html += `</div>`;
    }

    if (d.education.length) {
      html += `<div class="r-section"><div class="r-section-title">Education</div>`;
      d.education.forEach((edu) => {
        html += `<div class="r-edu-item">
          <div class="r-edu-head">
            <span class="r-role">${esc(edu.school) || "School"}</span>
            <span class="r-dates">${[edu.start, edu.end].filter(Boolean).map(esc).join(" – ")}</span>
          </div>
          <span class="r-company">${esc([edu.degree, edu.field].filter(Boolean).join(", "))}${edu.extra ? " · " + esc(edu.extra) : ""}</span>
        </div>`;
      });
      html += `</div>`;
    }

    if (d.skills.length) {
      html += `<div class="r-section"><div class="r-section-title">Skills</div><p class="r-skills">${d.skills.map(esc).join("  ·  ")}</p></div>`;
    }

    if (d.projects.length) {
      html += `<div class="r-section"><div class="r-section-title">Projects</div>`;
      d.projects.forEach((proj) => {
        html += `<div class="r-proj-item">
          <span class="r-proj-name">${esc(proj.name) || "Project name"}</span>
          ${proj.link ? `<span class="r-dates"> — ${esc(proj.link)}</span>` : ""}
          ${proj.description ? `<p class="r-proj-desc">${esc(proj.description)}</p>` : ""}
        </div>`;
      });
      html += `</div>`;
    }

    sheetEl.innerHTML = html;
  }

  renderForm();
  renderPreview();
})();
