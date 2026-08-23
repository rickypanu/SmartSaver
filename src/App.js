import React, { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update, push } from "firebase/database";
import { Html5QrcodeScanner } from "html5-qrcode";
import { Power, QrCode, ShieldAlert, Cpu, PlusCircle, CheckCircle, Wifi, WifiOff, Zap } from "lucide-react";

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  databaseURL: "https://smartsaver-iot-default-rtdb.firebaseio.com/",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export default function SmartHubDashboard() {
  const [macAddress, setMacAddress] = useState("");
  const [activeMac, setActiveMac] = useState(""); // MAC currently bound to the view
  const [deviceData, setDeviceData] = useState(null);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: "", text: "" });

  // --- Helper to Show Notification ---
  const showStatus = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage({ type: "", text: "" }), 4000);
  };

  // --- 1. QR CODE SCANNER SETUP ---
  useEffect(() => {
    if (isScanning) {
      const scanner = new Html5QrcodeScanner("qr-reader", {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      });

      scanner.render(
        (decodedText) => {
          const cleanMac = decodedText.trim().toUpperCase();
          setMacAddress(cleanMac);
          setActiveMac(cleanMac);
          setIsScanning(false);
          scanner.clear();
        },
        () => {}
      );

      return () => {
        scanner.clear().catch(() => {});
      };
    }
  }, [isScanning]);

  // --- 2. REALTIME FIREBASE SUBSCRIBER ---
  useEffect(() => {
    if (!activeMac) return;

    // Listen to /devices/<MAC>
    const deviceRef = ref(db, `devices/${activeMac}`);
    const unsubscribeDevice = onValue(deviceRef, (snapshot) => {
      if (snapshot.exists()) {
        setDeviceData(snapshot.val());
      } else {
        setDeviceData(null);
      }
    });

    // Listen to /history/<MAC>
    const historyRef = ref(db, `history/${activeMac}`);
    const unsubscribeHistory = onValue(historyRef, (snapshot) => {
      if (snapshot.exists()) {
        const rawData = snapshot.val();
        const parsedLogs = Object.keys(rawData)
          .map((key) => ({ id: key, ...rawData[key] }))
          .reverse();
        setHistoryLogs(parsedLogs);
      } else {
        setHistoryLogs([]);
      }
    });

    return () => {
      unsubscribeDevice();
      unsubscribeHistory();
    };
  }, [activeMac]);

  // --- 3. DEVICE REGISTRATION / PROVISIONING ---
  const handleConnectOrAddDevice = () => {
    const formattedMac = macAddress.trim().toUpperCase();
    if (!formattedMac) {
      showStatus("error", "Please enter or scan a valid MAC address.");
      return;
    }

    // Set as active query MAC
    setActiveMac(formattedMac);

    // Provision base structure in Firebase if missing
    const deviceRef = ref(db, `devices/${formattedMac}`);
    onValue(
      deviceRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          const initialDeviceSchema = {
            created_at: new Date().toISOString(),
            last_seen: Date.now(),
            sensors: { motion: false },
            ports: {
              D1: { mode: "manual", state: false },
              D2: { mode: "manual", state: false },
              D3: { mode: "manual", state: false },
              D4: { mode: "manual", state: false },
            },
          };
          set(deviceRef, initialDeviceSchema);
          
          // Log Creation Event
          const historyRef = ref(db, `history/${formattedMac}`);
          push(historyRef, {
            port: "SYSTEM",
            action: "Device Registered",
            trigger: "Web Dashboard",
            timestamp: Date.now(),
          });

          showStatus("success", `Device ${formattedMac} registered successfully!`);
        } else {
          showStatus("success", `Connected to device ${formattedMac}`);
        }
      },
      { onlyOnce: true }
    );
  };

  // --- 4. COMMAND HANDLERS & LOGGING ---
  const logEvent = (portKey, action, trigger) => {
    if (!activeMac) return;
    const historyRef = ref(db, `history/${activeMac}`);
    push(historyRef, {
      port: portKey,
      action: action,
      trigger: trigger,
      timestamp: Date.now(),
    });
  };

  const togglePortState = (portKey, currentState) => {
    if (!activeMac) return;
    const nextState = !currentState;
    set(ref(db, `devices/${activeMac}/ports/${portKey}/state`), nextState);
    logEvent(portKey, nextState ? "Turned ON" : "Turned OFF", "Manual Click");
  };

  const togglePortMode = (portKey, currentMode) => {
    if (!activeMac) return;
    const activeMode = currentMode || "manual";
    const newMode = activeMode === "manual" ? "auto" : "manual";
    set(ref(db, `devices/${activeMac}/ports/${portKey}/mode`), newMode);
    logEvent(portKey, `Mode changed to ${newMode.toUpperCase()}`, "User Override");
  };

  const setAllPorts = (targetState) => {
    if (!activeMac) return;
    const updates = {};
    ["D1", "D2", "D3", "D4"].forEach((p) => {
      updates[`devices/${activeMac}/ports/${p}/state`] = targetState;
    });
    update(ref(db), updates);
    logEvent("ALL", targetState ? "Master ON" : "Master OFF", "Quick Action");
  };

  // --- Check Hub Connectivity ---
  const isHubOnline = deviceData?.last_seen 
    ? Date.now() - deviceData.last_seen < 15000 
    : false;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h2><Cpu size={28} /> Smart Saver IoT Dashboard</h2>
      </header>

      {/* MAC ADDRESS INPUT & PROVISIONING BAR */}
      <div style={styles.card}>
        <label style={styles.label}>Device MAC Address</label>
        <div style={styles.flexRow}>
          <input
            type="text"
            placeholder="e.g., 48:55:19:XX:XX:XX"
            value={macAddress}
            onChange={(e) => setMacAddress(e.target.value.toUpperCase())}
            style={styles.input}
          />
          <button style={styles.scanBtn} onClick={() => setIsScanning(!isScanning)}>
            <QrCode size={18} /> {isScanning ? "Close" : "Scan QR"}
          </button>
          <button style={styles.addBtn} onClick={handleConnectOrAddDevice}>
            <PlusCircle size={18} /> Connect / Add Device
          </button>
        </div>

        {isScanning && <div id="qr-reader" style={{ marginTop: "15px" }}></div>}

        {statusMessage.text && (
          <div style={{
            ...styles.alertBanner,
            backgroundColor: statusMessage.type === "error" ? "#ffebee" : "#e8f5e9",
            color: statusMessage.type === "error" ? "#c62828" : "#2e7d32",
          }}>
            {statusMessage.type === "error" ? <ShieldAlert size={16} /> : <CheckCircle size={16} />}
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>

      {activeMac && (
        <>
          {/* DEVICE STATUS OVERVIEW */}
          <div style={styles.card}>
            <div style={styles.flexBetween}>
              <h3>Active Device: <code>{activeMac}</code></h3>
              <div style={{
                ...styles.onlineBadge,
                backgroundColor: isHubOnline ? "#e8f5e9" : "#fff3e0",
                color: isHubOnline ? "#2e7d32" : "#e65100",
              }}>
                {isHubOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
                <span>{isHubOnline ? "ONLINE" : "OFFLINE / PENDING"}</span>
              </div>
            </div>

            {deviceData ? (
              <div style={styles.statusRow}>
                <div style={{
                  ...styles.statusBadge,
                  backgroundColor: deviceData.sensors?.motion ? "#ffebee" : "#f1f8e9",
                  color: deviceData.sensors?.motion ? "#c62828" : "#33691e",
                  flex: 1
                }}>
                  <ShieldAlert size={18} />
                  <span>PIR Motion: <strong>{deviceData.sensors?.motion ? "MOTION DETECTED" : "CLEAR"}</strong></span>
                </div>

                <div style={styles.quickActions}>
                  <button style={styles.quickBtnOn} onClick={() => setAllPorts(true)}>
                    <Zap size={14} /> Turn All ON
                  </button>
                  <button style={styles.quickBtnOff} onClick={() => setAllPorts(false)}>
                    <Power size={14} /> Turn All OFF
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ color: "#666", marginTop: "10px" }}>
                No active payload found for this MAC. Click <strong>"Connect / Add Device"</strong> above to register it.
              </p>
            )}
          </div>

          {/* PORT CONTROL GRID */}
          {deviceData && (
            <div style={styles.grid}>
              {["D1", "D2", "D3", "D4"].map((portKey) => {
                const port = deviceData.ports?.[portKey] || {};
                const mode = port.mode || "manual";
                const state = Boolean(port.state);
                const isManual = mode === "manual";

                return (
                  <div key={portKey} style={styles.portCard}>
                    <div style={styles.portHeader}>
                      <h4>Port {portKey}</h4>
                      <button
                        style={{
                          ...styles.modeBadge,
                          backgroundColor: isManual ? "#e3f2fd" : "#fff3e0",
                          color: isManual ? "#1565c0" : "#e65100",
                        }}
                        onClick={() => togglePortMode(portKey, mode)}
                      >
                        {mode.toUpperCase()}
                      </button>
                    </div>

                    <button
                      disabled={!isManual}
                      onClick={() => togglePortState(portKey, state)}
                      style={{
                        ...styles.powerBtn,
                        backgroundColor: state ? "#4caf50" : "#757575",
                        cursor: isManual ? "pointer" : "not-allowed",
                        opacity: isManual ? 1 : 0.6,
                      }}
                    >
                      <Power size={22} /> {state ? "ON" : "OFF"}
                    </button>
                    {!isManual && <small style={styles.autoNote}>Controlled by PIR Sensor</small>}
                  </div>
                );
              })}
            </div>
          )}

          {/* EVENT LOG AUDIT */}
          <div style={styles.card}>
            <h3>Event History & Audit Trail</h3>
            <div style={styles.historyContainer}>
              {historyLogs.length === 0 ? (
                <p style={{ color: "#888", fontSize: "14px" }}>No activity logs recorded yet.</p>
              ) : (
                historyLogs.slice(0, 15).map((log) => (
                  <div key={log.id} style={styles.logItem}>
                    <span>
                      <strong>[{log.port || "SYSTEM"}]</strong> {log.action || "Event"}
                    </span>
                    <span style={styles.logMeta}>
                      Trigger: {log.trigger || "Auto"} {log.timestamp && `• ${new Date(log.timestamp).toLocaleTimeString()}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Inline CSS Styles
const styles = {
  container: { maxWidth: "850px", margin: "0 auto", padding: "20px", fontFamily: "sans-serif", backgroundColor: "#f4f6f8", minHeight: "100vh" },
  header: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px", borderBottom: "2px solid #ddd", paddingBottom: "10px" },
  card: { backgroundColor: "#fff", padding: "20px", borderRadius: "10px", boxShadow: "0 2px 6px rgba(0,0,0,0.06)", marginBottom: "20px" },
  label: { display: "block", marginBottom: "8px", fontWeight: "bold", fontSize: "14px", color: "#333" },
  flexRow: { display: "flex", gap: "10px", flexWrap: "wrap" },
  flexBetween: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  input: { flex: 1, minWidth: "220px", padding: "10px 12px", fontSize: "15px", borderRadius: "6px", border: "1px solid #ccc" },
  scanBtn: { padding: "10px 14px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", borderRadius: "6px", border: "1px solid #007bff", backgroundColor: "#fff", color: "#007bff", fontWeight: "bold" },
  addBtn: { padding: "10px 16px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", borderRadius: "6px", border: "none", backgroundColor: "#007bff", color: "#fff", fontWeight: "bold" },
  alertBanner: { display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderRadius: "6px", marginTop: "12px", fontSize: "14px" },
  onlineBadge: { display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "bold" },
  statusRow: { display: "flex", gap: "15px", marginTop: "15px", flexWrap: "wrap", alignItems: "center" },
  statusBadge: { display: "flex", alignItems: "center", gap: "10px", padding: "12px", borderRadius: "6px", fontSize: "14px" },
  quickActions: { display: "flex", gap: "8px" },
  quickBtnOn: { padding: "8px 12px", border: "none", borderRadius: "6px", backgroundColor: "#e8f5e9", color: "#2e7d32", cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px" },
  quickBtnOff: { padding: "8px 12px", border: "none", borderRadius: "6px", backgroundColor: "#ffebee", color: "#c62828", cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "15px", marginBottom: "20px" },
  portCard: { backgroundColor: "#fff", padding: "16px", borderRadius: "10px", boxShadow: "0 2px 6px rgba(0,0,0,0.06)", textAlign: "center" },
  portHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" },
  modeBadge: { padding: "4px 8px", borderRadius: "12px", border: "none", fontSize: "11px", fontWeight: "bold", cursor: "pointer" },
  powerBtn: { width: "100%", padding: "12px", color: "#fff", border: "none", borderRadius: "6px", fontSize: "15px", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", transition: "all 0.2s" },
  autoNote: { display: "block", marginTop: "8px", color: "#888", fontSize: "11px" },
  historyContainer: { maxHeight: "220px", overflowY: "auto", marginTop: "10px" },
  logItem: { display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #eee", fontSize: "13px" },
  logMeta: { color: "#777", fontSize: "12px" }
};