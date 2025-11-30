// src/App.tsx
import React, { useState, useRef, useEffect } from "react";
import jsPDF from "jspdf";
import domtoimage from "dom-to-image";
import { supabase } from "./supabaseClient";
import "./styles.css";

const getUserFromURL = (): string => {
  const params = new URLSearchParams(window.location.search);
  return params.get("user") || "Anonyme";
};

const logChange = async (user: string, action: string, details: object) => {
  const { error } = await supabase.from("logs").insert([{ user, action, details }]);
  if (error) {
    console.error("❌ Erreur journalisation :", error.message);
  }
};

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

const createChairs = (tableId: number, count = 10, prevChairs: Chair[] = []): Chair[] => {
  const angleStep = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => ({
    id: tableId * 100 + i,
    name: prevChairs[i]?.name || "",
    group: prevChairs[i]?.group || "",
    angle: i * angleStep,
  }));
};

const generateInitialTables = (): Table[] => {
  const tables: Table[] = [];
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
  const spacingX = 160;
  const spacingY = 140;
  for (let i = 1; i <= 50; i++) {
    const leftSide = i <= 25;
    const row = Math.floor(((i - 1) % 25) / 5);
    const col = (i - 1) % 5;
    const x = leftSide ? 300 + col * spacingX : 1000 + col * spacingX;
    const y = 300 + row * spacingY;
    tables.push({ id: i, x, y, chairs: createChairs(i), isDragging: false });
  }
  return tables;
};

export default function App() {
  const [tables, setTables] = useState<Table[]>(generateInitialTables());
  const [savedTables, setSavedTables] = useState<Table[]>(generateInitialTables());
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [showRecap, setShowRecap] = useState(false);

  const [selectedChair, setSelectedChair] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const planRef = useRef<SVGSVGElement | null>(null);

  const isLocalUpdate = useRef(false);
  const isRemoteUpdate = useRef(false);

  // 1) Chargement initial : si la ligne id=1 n'existe pas, on la crée.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("tables")
        .select("data")
        .eq("id", 1)
        .single();

      if (error) {
        // S'il manque la ligne (code PGRST116 ou 406), on l'insère.
        console.warn("⚠️ Lecture tables(id=1) :", error.message);
        const seed = generateInitialTables();
        const { error: insertErr } = await supabase
          .from("tables")
          .upsert([{ id: 1, data: seed }], { onConflict: "id" });
        if (insertErr) {
          console.error("❌ Échec création tables(id=1) :", insertErr.message);
          alert("Échec d'initialisation Supabase (tables). Voir console.");
        } else {
          setTables(seed);
          setSavedTables(seed);
        }
      } else if (data?.data) {
        setTables(data.data);
        setSavedTables(data.data);
      }
    })();
  }, []);

  // 2) Realtime : applique les updates distants si on n’a pas de brouillon local
  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase
        .from("tables")
        .select("data")
        .eq("id", 1)
        .single();
      if (error) {
        console.error("❌ Échec d'initialisation Supabase :", error.message);
        alert("Échec d'initialisation Supabase (tables). Voir console.");
      } else if (data?.data) {
        setTables(data.data);
        setSavedTables(data.data);
        setUnsavedChanges(false);
      }
    };
    init();
  }, [])

  // 3) Sauvegarde automatique quand isLocalUpdate=true
  useEffect(() => {
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }
    if (!isLocalUpdate.current) return;

    (async () => {
      const { error } = await supabase
        .from("tables")
        .upsert([{ id: 1, data: tables }], { onConflict: "id" });
      if (error) {
        console.error("❌ Erreur enregistrement Supabase :", error.message);
        alert("Sauvegarde échouée (voir console). Vérifie les règles RLS.");
      } else {
        setSavedTables(tables);
        setUnsavedChanges(false);
      }
      isLocalUpdate.current = false;
    })();
  }, [tables]);

  // Drag & drop
  const handleMouseDown = (e: React.MouseEvent, id: number) => {
    setDragOffset({ x: e.clientX, y: e.clientY });
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, isDragging: true } : t)));
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    const dx = e.clientX - dragOffset.x;
    const dy = e.clientY - dragOffset.y;
    setDragOffset({ x: e.clientX, y: e.clientY });
    setTables((prev) => prev.map((t) => (t.isDragging ? { ...t, x: t.x + dx, y: t.y + dy } : t)));
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

  // Edit d’un siège
  const updateChair = (tableId: number, chairId: number, field: string, value: string) => {
    const user = getUserFromURL();
    setUnsavedChanges(true);
    isLocalUpdate.current = true;
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== tableId) return t;
        const updatedChairs = t.chairs.map((c) => {
          if (c.id !== chairId) return c;
          const previous = { ...c };
          const updated = { ...c, [field]: value };
          logChange(user, "update_chair", { tableId, chairId, field, previous, updated });
          return updated;
        });
        return { ...t, chairs: updatedChairs };
      })
    );
  };

  // + / − sièges
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
        logChange(user, "adjust_chair_count", { tableId, before: previous, after: newCount });
        return { ...t, chairs: newChairs };
      })
    );
  };

  // Sauvegarde manuelle
  const handleSave = async () => {
    isLocalUpdate.current = true;
    setUnsavedChanges(false);
    const user = getUserFromURL();
    const { error } = await supabase
      .from("tables")
      .upsert([{ id: 1, data: tables }], { onConflict: "id" });
    if (error) {
      console.error("❌ Erreur enregistrement Supabase :", error.message);
      alert("Sauvegarde échouée (voir console). Vérifie les règles RLS.");
    } else {
      setSavedTables(tables);
      await logChange(user, "save_tables", { version: new Date().toISOString() });
    }
  };

  // Réinitialiser : revenir à la dernière version sauvegardée
  const handleReset = () => {
    setTables(savedTables);
    setUnsavedChanges(false);
    isLocalUpdate.current = false;
    const user = getUserFromURL();
    logChange(user, "reset_changes", {});
  };

  // Historique : dernier 50 logs
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
    if (error) {
      console.error("❌ Erreur lecture logs :", error.message);
      alert("Lecture de l'historique impossible (voir console). Vérifie les règles RLS.");
    } else {
      setHistory(data || []);
      setShowHistory(true);
    }
  };

  // Export PDF
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
    const groupCount: Record<string, number> = {};
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

  return (
    <div onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onClick={() => setSelectedChair(null)}>
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
        <button onClick={handleSave} disabled={!unsavedChanges}>💾 Sauvegarder</button>
        <button onClick={handleReset} disabled={!unsavedChanges}>♻️ Réinitialiser</button>
        <button onClick={toggleHistory}>{showHistory ? "Fermer l'historique" : "Voir l'historique"}</button>
        <button onClick={exportToPDF}>📄 Exporter PDF</button>
      </div>

      <svg ref={planRef} width="1600" height="2200" style={{ background: "#f0f4f8" }}>
        <rect x={740} y={0} width={120} height={2200} fill="#e5e7eb" />
        <line x1={800} y1={0} x2={800} y2={2200} stroke="#9ca3af" strokeWidth={2} />

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
                <rect width={100} height={40} x={-50} y={-20} fill="#facc15" stroke="#000" />
                <text textAnchor="middle" y={5} fontSize={14}>Table Mariés</text>
              </>
            ) : (
              <>
                <circle r={50} fill={table.id % 2 === 0 ? "#bbf7d0" : "#bfdbfe"} stroke="#000" />
                <text textAnchor="middle" y={0} fontSize={12}>Table {table.id}</text>
                <text
                  x={-10} y={20} fontSize={14}
                  onClick={(e) => { e.stopPropagation(); adjustChairCount(table.id, -1); }}
                  style={{ cursor: "pointer" }}
                >−</text>
                <text
                  x={10} y={20} fontSize={14}
                  onClick={(e) => { e.stopPropagation(); adjustChairCount(table.id, 1); }}
                  style={{ cursor: "pointer" }}
                >+</text>
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
                  onClick={(e) => { e.stopPropagation(); setSelectedChair(chair.id); }}
                >
                  <circle r={14} fill={isMatch ? "#fef08a" : "#93c5fd"} stroke="#0369a1" />
                  {selectedChair === chair.id ? (
                    <foreignObject x={-40} y={-20} width={80} height={50}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <input
                          value={chair.name}
                          onChange={(e) => updateChair(table.id, chair.id, "name", e.target.value)}
                          placeholder="Nom"
                          autoFocus
                          style={{ fontSize: 10, width: "100%" }}
                        />
                        <select
                          value={chair.group}
                          onChange={(e) => updateChair(table.id, chair.id, "group", e.target.value)}
                          style={{ fontSize: 10, width: "100%" }}
                        >
                          <option value="">-- Sélectionner un groupe --</option>
                          {predefinedGroups.map((group) => (
                            <option key={group} value={group}>{group}</option>
                          ))}
                        </select>
                      </div>
                    </foreignObject>
                  ) : (
                    chair.name && <text y={4} textAnchor="middle" fontSize={10}>{chair.name}</text>
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
