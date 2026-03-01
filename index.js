const {
  div,
  h5,
  img,
  button,
  p,
  script,
  style,
  i,
  span,
  a,
  small,
} = require("@saltcorn/markup/tags");
const Table = require("@saltcorn/data/models/table");
const Field = require("@saltcorn/data/models/field");
const File = require("@saltcorn/data/models/file");
const Form = require("@saltcorn/data/models/form");
const Workflow = require("@saltcorn/data/models/workflow");
const { getState } = require("@saltcorn/data/db/state");
const crypto = require("crypto");

const TABLE_NAME = "screenshot-helper";
const FOLDER = "/";
const MIN_ROLE_PUBLIC = 100;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

// ---------------------------------------------------------------------------
// Idempotent table creation
// ---------------------------------------------------------------------------
async function ensureTable() {
  let table = Table.findOne({ name: TABLE_NAME });
  if (table) return table;

  // Table not in cache — try to create it; it might already exist in the DB
  // (e.g. created during a previous preview run but cache wasn't refreshed)
  try {
    await Table.create(TABLE_NAME);
  } catch (e) {
    if (!e.message?.includes("already exists")) throw e;
    // Relation already exists in DB — that's fine, continue
  }

  // Force in-memory cache refresh so Table.findOne can see the table
  const state = getState();
  await (state.refresh_tables?.() ?? state.refresh?.() ?? Promise.resolve());

  table = Table.findOne({ name: TABLE_NAME });
  if (!table) throw new Error(`Table "${TABLE_NAME}" not found after creation`);

  // Add any missing fields (idempotent — skip fields that already exist)
  const existingFields = new Set((table.fields || []).map((f) => f.name));
  for (const [name, label, required] of [
    ["filename", "Filename", true],
    ["url", "URL", true],
    ["mime_type", "MIME type", false],
  ]) {
    if (!existingFields.has(name)) {
      await Field.create({
        table_id: table.id,
        table,
        name,
        label,
        type: "String",
        required,
      });
    }
  }

  return table;
}

// ---------------------------------------------------------------------------
// Gallery card HTML (used server-side and mirrored client-side)
// ---------------------------------------------------------------------------
function galleryCard(row, rnd) {
  const serveUrl = "/files/serve/" + row.url;
  return div(
    { class: "col-xl-3 col-lg-4 col-md-6 mb-4" },
    div(
      { class: "card h-100 shadow-sm" },
      a(
        { href: serveUrl, target: "_blank" },
        img({
          src: serveUrl,
          class: "card-img-top",
          style: "object-fit:cover;height:180px;",
          alt: row.filename,
        })
      ),
      div(
        { class: "card-body p-2" },
        small({ class: "text-muted d-block mb-2 text-truncate" }, row.filename),
        button(
          {
            class: "btn btn-sm btn-outline-primary w-100 mb-1",
            onclick: `scCopyLink_${rnd}('${row.url.replace(/'/g, "\\'")}', this)`,
          },
          i({ class: "fas fa-link" }),
          " Copy link"
        ),
        button(
          {
            class: "btn btn-sm btn-outline-danger w-100",
            onclick: `scDelete_${rnd}(${row.id}, this)`,
          },
          i({ class: "fas fa-trash" }),
          " Delete"
        )
      )
    )
  );
}

// ---------------------------------------------------------------------------
// run — main view renderer
// ---------------------------------------------------------------------------
const run = async (table_id, viewname, cfg, state, { req }) => {
  const table = await ensureTable();
  const rows = await table.getRows({}, { orderBy: "id", orderDesc: true });

  const rnd = Math.random().toString(36).slice(2, 8);

  const galleryCards = rows.map((row) => galleryCard(row, rnd)).join("");

  // Embed CSRF token server-side as a reliable fallback
  const csrfToken = req.csrfToken ? req.csrfToken() : "";

  const clientJs = `
(function() {
  var VN = ${JSON.stringify(viewname)};
  var RND = ${JSON.stringify(rnd)};
  // CSRF token — prefer the runtime helper, fall back to server-embedded value
  var SC_CSRF = ${JSON.stringify(csrfToken)};
  function getCsrf() {
    if (typeof _sc_getCsrf === 'function') return _sc_getCsrf();
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute('content');
    var field = document.querySelector('input[name="_csrf"]');
    if (field) return field.value;
    return SC_CSRF;
  }

  // Paste handler
  document.addEventListener('paste', async function(e) {
    var items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    var imgItem = items.find(function(it) { return it.type && it.type.startsWith('image/'); });
    if (!imgItem) return;

    var blob = imgItem.getAsFile();
    if (!blob) return;
    var mimeType = blob.type || 'image/png';
    var ext = (mimeType.split('/')[1] || 'png').split('+')[0];

    var status = document.getElementById('sc-status-' + RND);
    if (status) status.innerHTML = '<div class="alert alert-info py-1 mb-0">Uploading\u2026</div>';

    var formData = new FormData();
    formData.append('file', blob, 'screenshot.' + ext);

    try {
      var resp = await fetch('/view/' + VN + '/upload', {
        method: 'POST',
        headers: { 'CSRF-Token': getCsrf() },
        body: formData,
      });
      var res = await resp.json();

      if (res.error) {
        if (status) status.innerHTML = '<div class="alert alert-danger py-1 mb-0">Error: ' + res.error + '</div>';
      } else {
        if (status) status.innerHTML = '<div class="alert alert-success py-1 mb-0">Uploaded!</div>';
        setTimeout(function() { if (status) status.innerHTML = ''; }, 3000);
        window['scAddToGallery_' + RND](res.url, res.id, res.filename);
      }
    } catch (err) {
      if (status) status.innerHTML = '<div class="alert alert-danger py-1 mb-0">Error: ' + err.message + '</div>';
    }
  });

  // Copy link to clipboard
  window['scCopyLink_' + RND] = function(url, btn) {
    var fullUrl = window.location.origin + '/files/serve/' + url;
    var orig = btn.innerHTML;
    function markCopied() {
      btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      btn.classList.replace('btn-outline-primary', 'btn-success');
      setTimeout(function() {
        btn.innerHTML = orig;
        btn.classList.replace('btn-success', 'btn-outline-primary');
      }, 2500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullUrl).then(markCopied).catch(function() {
        fallbackCopy(fullUrl, markCopied);
      });
    } else {
      fallbackCopy(fullUrl, markCopied);
    }
  };
  function fallbackCopy(text, cb) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); cb(); } catch(_) {}
    document.body.removeChild(ta);
  }

  // Delete screenshot (no confirmation)
  window['scDelete_' + RND] = function(id, btn) {
    view_post(VN, 'delete_screenshot', { id: id }, function(res) {
      if (res.error) {
        alert(res.error);
      } else {
        var col = btn.closest('.col-xl-3');
        if (col) col.remove();
      }
    });
  };

  // Add newly uploaded screenshot to top of gallery
  window['scAddToGallery_' + RND] = function(url, id, filename) {
    var gallery = document.getElementById('sc-gallery-' + RND);
    if (!gallery) return;
    var serveUrl = '/files/serve/' + url;
    var col = document.createElement('div');
    col.className = 'col-xl-3 col-lg-4 col-md-6 mb-4';
    col.innerHTML =
      '<div class="card h-100 shadow-sm">' +
        '<a href="' + serveUrl + '" target="_blank">' +
          '<img src="' + serveUrl + '" class="card-img-top" style="object-fit:cover;height:180px;" alt="' + filename + '">' +
        '</a>' +
        '<div class="card-body p-2">' +
          '<small class="text-muted d-block mb-2 text-truncate">' + filename + '</small>' +
          '<button class="btn btn-sm btn-outline-primary w-100 mb-1" onclick="scCopyLink_' + RND + '(\\'' + url.replace(/'/g, "\\\\'") + '\\', this)">' +
            '<i class="fas fa-link"></i> Copy link' +
          '</button>' +
          '<button class="btn btn-sm btn-outline-danger w-100" onclick="scDelete_' + RND + '(' + id + ', this)">' +
            '<i class="fas fa-trash"></i> Delete' +
          '</button>' +
        '</div>' +
      '</div>';
    gallery.prepend(col);
  };
})();
`;

  return (
    div(
      { class: "container-fluid mt-3" },
      div(
        { class: "card mb-4 border-primary" },
        div(
          {
            class: "card-body text-center py-5",
            id: "sc-paste-zone-" + rnd,
          },
          i({ class: "fas fa-clipboard fa-3x text-primary mb-3 d-block" }),
          p({ class: "lead mb-1" }, "Ctrl+V / \u2318V to paste a screenshot"),
          p(
            { class: "text-muted small" },
            "The screenshot will be uploaded automatically and appear in the gallery below. PNG, JPEG, GIF, WebP, BMP \u00b7 max 5\u202fMB."
          ),
          div({ id: "sc-status-" + rnd, class: "mt-2" })
        )
      ),
      h5(
        { class: "mb-3" },
        "Saved screenshots (" + rows.length + ")"
      ),
      div({ class: "row", id: "sc-gallery-" + rnd }, galleryCards),
      script(clientJs)
    )
  );
};

// ---------------------------------------------------------------------------
// Route: upload
// ---------------------------------------------------------------------------
const upload = async (table_id, viewname, cfg, body, { req }) => {
  try {
    if (!req.files || !req.files.file) {
      return { json: { error: "No file received" } };
    }

    const rawFile = req.files.file;
    const mimeType = rawFile.mimetype || "";

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return { json: { error: "Only image files are allowed (PNG, JPEG, GIF, WebP, BMP)" } };
    }
    if (rawFile.size > MAX_FILE_SIZE) {
      return { json: { error: "File too large — maximum size is 5 MB" } };
    }

    const ext = (mimeType.split("/")[1] || "png").split("+")[0];
    const uuid = crypto.randomUUID();
    const filename = `${uuid}.${ext}`;

    // Use from_req_files so the temp file is moved via mv() rather than
    // written from rawFile.data (which is empty when useTempFiles is active)
    const file = await File.from_req_files(
      { ...rawFile, name: filename },
      req.user?.id || null,
      MIN_ROLE_PUBLIC,
      FOLDER
    );

    // Save metadata row
    const table = await ensureTable();
    const id = await table.insertRow({
      filename,
      url: file.path_to_serve,
      mime_type: mimeType,
    });

    return { json: { success: true, url: file.path_to_serve, id, filename } };
  } catch (e) {
    return { json: { error: e.message } };
  }
};

// ---------------------------------------------------------------------------
// Route: delete_screenshot
// ---------------------------------------------------------------------------
const delete_screenshot = async (table_id, viewname, cfg, body, { req }) => {
  try {
    const table = Table.findOne({ name: TABLE_NAME });
    if (!table) return { json: { error: "Table not found" } };

    const id = parseInt(body.id, 10);
    if (isNaN(id)) return { json: { error: "Invalid ID" } };

    const row = await table.getRow({ id });
    if (!row) return { json: { error: "Row not found" } };

    // Try to delete the file (graceful — don't fail if it's already gone)
    try {
      const files = await File.find({ filename: row.filename });
      if (files.length > 0) await files[0].delete();
    } catch (_) {}

    await table.deleteRows({ id });
    return { json: { success: true } };
  } catch (e) {
    return { json: { error: e.message } };
  }
};

// ---------------------------------------------------------------------------
// Configuration workflow (no required settings)
// ---------------------------------------------------------------------------
const configuration_workflow = (req) =>
  new Workflow({
    steps: [
      {
        name: "Configuration",
        form: async () => new Form({ fields: [] }),
      },
    ],
  });

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------
module.exports = {
  sc_plugin_api_version: 1,
  plugin_name: "screenshot-helper",
  viewtemplates: [
    {
      name: "Screenshot Helper",
      tableless: true,
      get_state_fields: () => [],
      configuration_workflow,
      run,
      routes: { upload, delete_screenshot },
    },
  ],
};
