// App.tsx
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
  if (error) console.error("❌ Erreur journalisation :", error.message);
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

interface Chair { id: number; name: string; group: string; angle: number; }
interface Table { id: number; x: number; y: number; chairs: Chair[]; isDragging: boolean; special?: boolean; }

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
  // Table des mariés (spéciale)
  tables.push({
    id: 0, x: 700, y: 80,
    chairs: [
      { id: 1, name: "", group: "", angle: 0 },
      { id: 2, name: "", group: "", angle: Math.PI },
    ],
    isDragging: false,
    special: true,
  });
  // Autres tables
  const spacingX = 160, spacingY = 140;
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
  const [selectedChair, setSelectedChair] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showRecap, setShowRecap] = useState(false);
  const planRef = useRef(null);
  const isLocalUpdate = useRef(false); // **ref pour marquer les mises à jour locales**

  // Chargement initial depuis Supabase
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("tables").select("data").eq("id", 1).single();
      if (error) {
        console.error("❌ Erreur chargement Supabase :", error.message);
      } else if (data) {
        console.log("✅ Données récupérées Supabase :", data);
        setTables(data.data);
      }
    })();
  }, []);

  // Abonnement temps réel Supabase (écoute des UPDATE sur table id=1)
  useEffect(() => {
    const channel = supabase
      .channel("realtime-tables")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tables", filter: "id=eq.1" },
        payload => {
          const updatedData = (payload.new as any).data;
          console.log("📥 Mise à jour reçue en temps réel :", updatedData);
          setTables(updatedData);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Enregistrement sur Supabase des modifications locales
  useEffect(() => {
    if (!isLocalUpdate.current) return;
    const save = async () => {
      const { error } = await supabase.from("tables").upsert([{ id: 1, data: tables }]);
      if (error) {
        console.error("❌ Erreur enregistrement Supabase :", error.message);
      } else {
        console.log("✅ Données sauvegardées dans Supabase !");
      }
    };
    save();
    isLocalUpdate.current = false;
  }, [tables]);

  const handleMouseDown = (e: React.MouseEvent, id: number) => {
    setDragOffset({ x: e.clientX, y: e.clientY });
    setTables(prev =>
      prev.map(t => (t.id === id ? { ...t, isDragging: true } : t))
    );
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const dx = e.clientX - dragOffset.x;
    const dy = e.clientY - dragOffset.y;
    setDragOffset({ x: e.clientX, y: e.clientY });
    setTables(prev =>
      prev.map(t => (t.isDragging ? { ...t, x: t.x + dx, y: t.y + dy } : t))
    );
  };

  const handleMouseUp = () => {
    const user = getUserFromURL();
    setTables(prev =>
      prev.map(t => {
        if (t.isDragging) {
          // Log du déplacement et marquage pour sauvegarde
          logChange(user, "move_table", { tableId: t.id, newX: t.x, newY: t.y });
          isLocalUpdate.current = true;
          return { ...t, isDragging: false };
        }
        return { ...t, isDragging: false };
      })
    );
  };

  const updateChair = (tableId: number, chairId: number, field: string, value: string) => {
    const user = getUserFromURL();
    isLocalUpdate.current = true;
    setTables(prev =>
      prev.map(t => {
        if (t.id === tableId) {
          const updatedChairs = t.chairs.map(c => {
            if (c.id === chairId) {
              const previous = { ...c };
              const updated = { ...c, [field]: value };
              logChange(user, "update_chair", {
                tableId, chairId, field, previous, updated,
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

  const adjustChairCount = (tableId: number, delta: number) => {
    const user = getUserFromURL();
    isLocalUpdate.current = true;
    setTables(prev =>
      prev.map(t => {
        if (t.id !== tableId || t.special) return t;
        const previous = t.chairs.length;
        const newCount = Math.max(1, Math.min(10, previous + delta));
        const newChairs = createChairs(t.id, newCount, t.chairs);
        logChange(user, "adjust_chair_count", {
          tableId, before: previous, after: newCount,
        });
        return { ...t, chairs: newChairs };
      })
    );
  };

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

    tables.forEach(table => {
      const title = table.special ? "Table des mariés" : `Table ${table.id}`;
      const names = table.chairs
        .map(c => `${c.name || "(vide)"}${c.group ? ` (${c.group})` : ""}`)
        .join(", ");
      if (y > 550) { pdf.addPage(); y = 40; }
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
    tables.forEach(t =>
      t.chairs.forEach(c => {
        if (c.group) groupCount[c.group] = (groupCount[c.group] || 0) + 1;
      })
    );
    Object.keys(groupCount).sort().forEach(group => {
      if (y > 550) { pdf.addPage(); y = 40; }
      pdf.text(`- ${group} : ${groupCount[group]} invité(s)`, 40, y);
      y += 20;
    });

    pdf.save("plan_de_table.pdf");
  };

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
          onChange={e => setSearch(e.target.value)}
        />
        <button onClick={() => setShowRecap(!showRecap)}>
          {showRecap ? "Masquer" : "Afficher"} le récapitulatif
        </button>
        <button onClick={exportToPDF}>📄 Exporter PDF</button>
      </div>
      <svg ref={planRef} width="1600" height="2200" style={{ background: "#f0f4f8" }}>
        <rect x={740} y={0} width={120} height={2200} fill="#e5e7eb" />
        <line x1={800} y1={0} x2={800} y2={2200} stroke="#9ca3af" strokeWidth={2} />
        {tables.map(table => (
          <g
            key={table.id}
            transform={`translate(${table.x},${table.y})`}
            onMouseDown={e => handleMouseDown(e, table.id)}
            onClick={e => e.stopPropagation()}
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
                  onClick={e => { e.stopPropagation(); adjustChairCount(table.id, -1); }}
                  style={{ cursor: "pointer" }}
                >−</text>
                <text
                  x={10} y={20} fontSize={14}
                  onClick={e => { e.stopPropagation(); adjustChairCount(table.id, 1); }}
                  style={{ cursor: "pointer" }}
                >+</text>
              </>
            )}
            {table.chairs.map(chair => {
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
                  onClick={e => { e.stopPropagation(); setSelectedChair(chair.id); }}
                >
                  <circle r={14} fill={isMatch ? "#fef08a" : "#93c5fd"} stroke="#0369a1" />
                  {selectedChair === chair.id ? (
                    <foreignObject x={-40} y={-20} width={80} height={50}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <input
                          value={chair.name}
                          onChange={e => updateChair(table.id, chair.id, "name", e.target.value)}
                          placeholder="Nom" autoFocus
                          style={{ fontSize: 10, width: "100%" }}
                        />
                        <select
                          value={chair.group}
                          onChange={e => updateChair(table.id, chair.id, "group", e.target.value)}
                          style={{ fontSize: 10, width: "100%" }}
                        >
                          <option value="">-- Sélectionner un groupe --</option>
                          {predefinedGroups.map((group, idx) => (
                            <option key={idx} value={group}>{group}</option>
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
    </div>
  );
}
