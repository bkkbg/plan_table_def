// src/App.tsx
import React, { useState, useRef, useEffect } from "react";
import jsPDF from "jspdf";
import domtoimage from "dom-to-image";
import { supabase } from "./supabaseClient";
import "./styles.css";

// Helper : lit ?user= dans l'URL ; retourne "Anonyme" par défaut.
const getUserFromURL = (): string => {
  const params = new URLSearchParams(window.location.search);
  return params.get("user") || "Anonyme";
};

// Helper : écrit dans la table logs; appelé après chaque sauvegarde/réinitialisation/édition de siège/déplacement
const logChange = async (
  user: string,
  action: string,
  details: object
): Promise<void> => {
  const { error } = await supabase
    .from("logs")
    .insert([{ user, action, details }]);
  if (error) {
    console.error("❌ Erreur journalisation :", error.message);
  }
};

// Groupes prédéfinis
const predefinedGroups = [
  "Famille Konkobo",
  "Famille Ganemtore",
  "Famille Ouedraogo",
  "Amis Laken",
  "Amis Bryan",
  "Amis KONKOBO",
  "Collègues Ganemtore",
  "Collègues KONKOBO",
];

interface Chair {
  id: number;
  name: string;
  group: string;
  angle: number;
}
interface Table {
  id: number;
  x: number;
  y: number;
  chairs: Chair[];
  isDragging: boolean;
  special?: boolean;
}

// Création des sièges pour chaque table
const createChairs = (
  tableId: number,
  count = 10,
  prevChairs: Chair[] = []
): Chair[] => {
  const angleStep = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => ({
    id: tableId * 100 + i,
    name: prevChairs[i]?.name || "",
    group: prevChairs[i]?.group || "",
    angle: i * angleStep,
  }));
};

// Disposition initiale : table des mariés + 50 tables
const generateInitialTables = (): Table[] => {
  const tables: Table[] = [];
  // Table des mariés
  tables.push({
    id: 0,
    x: 700,
    y: 80,
    chairs: [
      { id: 1, name: "", group: "", angle: 0 },
      { id: 2, name: "", group: "", angle: Math.PI },
    ],
    isDragging: false,
    special: true,
  });
  // 50 autres tables
  const spacingX = 160;
  const spacingY = 140;
  for (let i = 1; i <= 50; i++) {
    const leftSide = i <= 25;
    const row = Math.floor(((i - 1) % 25) / 5);
    const col = (i - 1) % 5;
    const x = leftSide ? 300 + col * spacingX : 1000 + col * spacingX;
    const y = 300 + row * spacingY;
    tables.push({
      id: i,
      x,
      y,
      chairs: createChairs(i),
      isDragging: false,
    });
  }
  return tables;
};

export default function App() {
  // État local des tables
  const [tables, setTables] = useState<Table[]>(generateInitialTables());
  // Dernière version sauvegardée
  const [savedTables, setSavedTables] = useState<Table[]>(generateInitialTables());
  // Indique s'il y a des modifications non sauvegardées
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  // Affichage de l’historique et stockage des logs
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  // ⬅️ Manquait : état pour le bouton récapitulatif
  const [showRecap, setShowRecap] = useState(false);

  // Autres états pour l’UI
  const [selectedChair, setSelectedChair] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const planRef = useRef<SVGSVGElement | null>(null);

  // Indicateurs pour savoir si l’update est locale ou distante
  const isLocalUpdate = useRef(false);
  const isRemoteUpdate = useRef(false);

  /** 1. Chargement initial depuis Supabase */
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("tables")
        .select("data")
        .eq("id", 1)
        .single();
      if (!error && data?.data) {
        setTables(data.data);
        setSavedTables(data.data);
      }
    })();
  }, []);

  /** 2. Écoute en temps réel des modifications distantes */
  useEffect(() => {
    const channel = supabase
      .channel("realtime-tables")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tables",
          filter: "id=eq.1",
        },
        (payload) => {
          const updatedData = (payload.new as any).data;
          isRemoteUpdate.current = true;
          setSavedTables(updatedData);
          // Si aucune modif locale en cours, on met à jour l’état local
          setTables((prev) => {
            return unsavedChanges ? prev : updatedData;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [unsavedChanges]);

  /** 3. Sauvegarde automatique des modifications locales */
  useEffect(() => {
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }
    if (!isLocalUpdate.current) return;

    const save = async () => {
      const { error } = await supabase.from("tables").upsert([{ id: 1, data: tables }]);
      if (!error) {
        setSavedTables(tables);
        setUnsavedChanges(false);
      }
    };
    save();
    isLocalUpdate.current = false;
  }, [tables]);

  /** 4. Gestion du drag & drop */
  const handleMouseDown = (e: React.MouseEvent, id: number) => {
    setDragOffset({ x: e.clientX, y: e.clientY });
    setTables((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isDragging: true } : t))
    );
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const dx = e.clientX - dragOffset.x;
    const dy = e.clientY - dragOffset.y;
    setDragOffset({ x: e.clientX, y: e.clientY });
    setTables((prev) =>
      prev.map((t) =>
        t.isDragging ? { ...t, x: t.x + dx, y: t.y + dy } : t
      )
    );
  };

  const handleMouseUp = () => {
    const user = getUserFromURL();
    setTables((prev) =>
      prev.map((t) => {
        if (t.isDragging) {
          logChange(user, "move_table", { tableId: t.id, newX: t.x, newY: t.y });
          isLocalUpdate.current = true;
          setUnsavedChanges(true);
          return { ...t, isDragging: false };
        }
        return { ...t, isDragging: false };
      })
    );
  };

  /** 5. Mise à jour d’un siège (nom ou groupe) */
  const updateChair = (
    tableId: number,
    chairId: number,
    field: string,
    value: string
  ) => {
    const user = getUserFromURL();
    setUnsavedChanges(true);
    isLocalUpdate.current = true;
    setTables((prev) =>
      prev.map((t) => {
        if (t.id === tableId) {
          const updatedChairs = t.chairs.map((c) => {
            if (c.id === chairId) {
              const previous = { ...c };
              const updated = { ...c, [field]: value };
              logChange(user, "update_chair", {
                tableId,
                chairId,
                field,
                previous,
                updated,
              });
              return updated;
            }
            return c;
          });
          return { ...t, chairs: updatedChairs };
        }
        return t;
      })
    );
  };

  /** 6. Ajuster le nombre de sièges (augmenter/diminuer) */
  const adjustChairCount = (tableId: number, delta: number) => {
    const user = getUserFromURL();
    setUnsavedChanges(true);
    isLocalUpdate.current = true;
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== tableId || t.special) return t;
        const previous = t.chairs.length;
        const newCount = Math.max(1, Math.min(10, previous + delta));
        const newChairs = createChairs(t.id, newCount, t.chairs);
        logChange(user, "adjust_chair_count", {
          tableId,
          before: previous,
          after: newCount,
        });
        return { ...t, chairs: newChairs };
      })
    );
  };

  /** 7. Sauvegarde manuelle immédiate */
  const handleSave = async () => {
    isLocalUpdate.current = true;
    setUnsavedChanges(false);
    const user = getUserFromURL();
    const { error } = await supabase
      .from("tables")
      .upsert([{ id: 1, data: tables }]);
    if (!error) {
      setSavedTables(tables);
      await logChange(user, "save_tables", {
        version: new Date().toISOString(),
      });
    } else {
      console.error("Erreur enregistrement Supabase :", error.message);
    }
  };

  /** 8. Réinitialiser : revenir à la dernière sauvegarde */
  const handleReset = () => {
    setTables(savedTables);
    setUnsavedChanges(false);
    isLocalUpdate.current = false;
    const user = getUserFromURL();
    logChange(user, "reset_changes", {});
  };

  /** 9. Afficher/cacher l’historique (charge les 50 derniers logs) */
  const toggleHistory = async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    const { data, error } = await supabase
      .from("logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error) {
      setHistory(data || []);
    }
    setShowHistory(true);
  };

  /** 10. Export PDF : plan + récapitulatifs */
  const exportToPDF = async () => {
    const pdf = new jsPDF("l", "pt", "a4");
    if (planRef.current) {
      const planImg = await domtoimage.toPng(planRef.current);
      pdf.addImage(planImg, "PNG", 0, 0, 820, 580);
    }
    pdf.addPage();
    let y = 40;
    pdf.setFontSize(16).setFont("helvetica", "bold");
    pdf.text("Récapitulatif des invités par table", 40, y);
    y += 30;
    pdf.setFontSize(10);

    tables.forEach((table) => {
      const title = table.special ? "Table des mariés" : `Table ${table.id}`;
      const names = table.chairs
        .map((c) => `${c.name || "(vide)"}${c.group ? ` (${c.group})` : ""}`)
        .join(", ");
      if (y > 550) {
        pdf.addPage();
        y = 40;
      }
      pdf.text(`• ${title} : ${names}`, 40, y);
      y += 20;
    });

    pdf.addPage();
    y = 40;
    pdf.setFontSize(16);
    pdf.text("Récapitulatif des groupes (nombre d'invités)", 40, y);
    y += 30;
    pdf.setFontSize(12);

    const groupCount: { [key: string]: number } = {};
    tables.forEach((t) =>
      t.chairs.forEach((c) => {
        if (c.group) groupCount[c.group] = (groupCount[c.group] || 0) + 1;
      })
    );
    Object.keys(groupCount)
      .sort()
      .forEach((group) => {
        if (y > 550) {
          pdf.addPage();
          y = 40;
        }
        pdf.text(`- ${group} : ${groupCount[group]} invité(s)`, 40, y);
        y += 20;
      });
    pdf.save("plan_de_table.pdf");
  };

  /** Rendu */
  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={() => setSelectedChair(null)}
    >
      <div className="controls">
        <input
          type="text"
          placeholder="🔍 Rechercher un invité"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button onClick={() => setShowRecap(!showRecap)}>
          {showRecap ? "Masquer" : "Afficher"} le récapitulatif
        </button>
        <button onClick={handleSave} disabled={!unsavedChanges}>
          💾 Sauvegarder
        </button>
        <button onClick={handleReset} disabled={!unsavedChanges}>
          ♻️ Réinitialiser
        </button>
        <button onClick={toggleHistory}>
          {showHistory ? "Fermer l'historique" : "Voir l'historique"}
        </button>
        <button onClick={exportToPDF}>📄 Exporter PDF</button>
      </div>

      <svg
        ref={planRef}
        width="1600"
        height="2200"
        style={{ background: "#f0f4f8" }}
      >
        <rect x={740} y={0} width={120} height={2200} fill="#e5e7eb" />
        <line
          x1={800}
          y1={0}
          x2={800}
          y2={2200}
          stroke="#9ca3af"
          strokeWidth={2}
        />

        {tables.map((table) => (
          <g
            key={table.id}
            transform={`translate(${table.x},${table.y})`}
            onMouseDown={(e) => handleMouseDown(e, table.id)}
            onClick={(e) => e.stopPropagation()}
            style={{ cursor: "move", userSelect: "none" }}
          >
            {table.special ? (
              <>
                <rect
                  width={100}
                  height={40}
                  x={-50}
                  y={-20}
                  fill="#facc15"
                  stroke="#000"
                />
                <text textAnchor="middle" y={5} fontSize={14}>
                  Table Mariés
                </text>
              </>
            ) : (
              <>
                <circle
                  r={50}
                  fill={table.id % 2 === 0 ? "#bbf7d0" : "#bfdbfe"}
                  stroke="#000"
                />
                <text textAnchor="middle" y={0} fontSize={12}>
                  Table {table.id}
                </text>
                <text
                  x={-10}
                  y={20}
                  fontSize={14}
                  onClick={(e) => {
                    e.stopPropagation();
                    adjustChairCount(table.id, -1);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  −
                </text>
                <text
                  x={10}
                  y={20}
                  fontSize={14}
                  onClick={(e) => {
                    e.stopPropagation();
                    adjustChairCount(table.id, 1);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  +
                </text>
              </>
            )}

            {table.chairs.map((chair) => {
              const cx = 70 * Math.cos(chair.angle);
              const cy = 70 * Math.sin(chair.angle);
              const isMatch =
                search &&
                (chair.name.toLowerCase().includes(search.toLowerCase()) ||
                  chair.group.toLowerCase().includes(search.toLowerCase()));
              return (
                <g
                  key={chair.id}
                  transform={`translate(${cx}, ${cy})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedChair(chair.id);
                  }}
                >
                  <circle
                    r={14}
                    fill={isMatch ? "#fef08a" : "#93c5fd"}
                    stroke="#0369a1"
                  />
                  {selectedChair === chair.id ? (
                    <foreignObject x={-40} y={-20} width={80} height={50}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <input
                          value={chair.name}
                          onChange={(e) =>
                            updateChair(table.id, chair.id, "name", e.target.value)
                          }
                          placeholder="Nom"
                          autoFocus
                          style={{ fontSize: 10, width: "100%" }}
                        />
                        <select
                          value={chair.group}
                          onChange={(e) =>
                            updateChair(table.id, chair.id, "group", e.target.value)
                          }
                          style={{ fontSize: 10, width: "100%" }}
                        >
                          <option value="">-- Sélectionner un groupe --</option>
                          {predefinedGroups.map((group) => (
                            <option key={group} value={group}>
                              {group}
                            </option>
                          ))}
                        </select>
                      </div>
                    </foreignObject>
                  ) : (
                    chair.name && (
                      <text y={4} textAnchor="middle" fontSize={10}>
                        {chair.name}
                      </text>
                    )
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>

      {showHistory && (
        <div
          style={{
            position: "fixed",
            top: 60,
            right: 10,
            width: 400,
            height: 400,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #ccc",
            boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
            padding: 10,
            zIndex: 100,
          }}
        >
          <h3>Historique des modifications</h3>
          {history.length === 0 && <p>Aucune entrée.</p>}
          {history.map((entry, idx) => (
            <div key={idx} style={{ marginBottom: 8 }}>
              <strong>{entry.created_at?.replace("T", " ").substring(0, 19)}</strong>
              <br />
              <em>{entry.user}</em> — {entry.action}
              <br />
              <code style={{ fontSize: 10 }}>{JSON.stringify(entry.details)}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
