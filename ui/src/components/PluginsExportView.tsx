import { useState } from "react";
import type { PluginManifest } from "../types";

interface PluginsExportViewProps {
  plugins: PluginManifest[];
  onTogglePlugin?: (id: string) => void;
  onExportCsv: () => Promise<string>;
  onExportVcf: () => Promise<string>;
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PluginsExportView({
  plugins,
  onTogglePlugin,
  onExportCsv,
  onExportVcf,
}: PluginsExportViewProps) {
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");

  async function handleExport(format: "csv" | "vcf") {
    if (format === "csv") {
      const csv = await onExportCsv();
      setPreviewLabel("folklore-contacts.csv (OWASP formula-injection neutralized)");
      setPreviewContent(csv);
      triggerDownload("folklore-contacts.csv", csv, "text/csv;charset=utf-8");
    } else {
      const vcf = await onExportVcf();
      setPreviewLabel("folklore-contacts.vcf (RFC 6350 vCard 4.0)");
      setPreviewContent(vcf);
      triggerDownload("folklore-contacts.vcf", vcf, "text/vcard;charset=utf-8");
    }
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-header">
          <div>
            <span className="panel-title">Portable Zero Lock-In Exports</span>
            <span className="cell-secondary" style={{ marginLeft: 10 }}>
              Plain-text Markdown is already portable; export CSV or vCard anytime in 1 click.
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleExport("csv")}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void handleExport("vcf")}
            >
              Export vCard (.vcf)
            </button>
          </div>
        </div>
        {previewLabel && (
          <div>
            <div
              className="cell-secondary mono"
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid var(--border-hairline)",
              }}
            >
              {previewLabel}
            </div>
            <pre className="code-preview mono" style={{ maxHeight: 220 }}>
              {previewContent}
            </pre>
          </div>
        )}
      </div>

      <div className="section-label" style={{ marginBottom: 10 }}>
        Validated Community Plugins ({plugins.length})
      </div>
      <div className="plugin-grid">
        {plugins.map((plugin) => (
          <div key={plugin.id} className="plugin-card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 650 }}>{plugin.name}</div>
                <div className="cell-secondary mono">
                  {plugin.id} | v{plugin.version} | {plugin.kind}
                </div>
              </div>
              <button
                type="button"
                className={`pill mono ${plugin.enabled ? "pill-pass" : ""}`}
                style={{ cursor: onTogglePlugin ? "pointer" : "default" }}
                onClick={() => onTogglePlugin?.(plugin.id)}
              >
                {plugin.enabled ? "enabled" : "disabled"}
              </button>
            </div>

            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              {plugin.description}
            </div>

            <pre
              className="code-preview mono"
              style={{
                borderRadius: 7,
                border: "1px solid var(--border-hairline)",
                maxHeight: 130,
                padding: "8px 10px",
              }}
            >
              {JSON.stringify(plugin.config, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
