"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Play, Loader2, AlertCircle, Code, MessageSquare, Gamepad2, TrendingUp, X, Clock, Mic, MicOff, ArrowRight, CheckCircle, MousePointer, ArrowUp, Eye, ExternalLink } from "lucide-react";

interface Message {
  type: string;
  content?: string;
  data?: string;
  session_id?: string;
  turn_number?: number;
  url?: string;
  action?: string;
  function_name?: string;
  args?: Record<string, any>;
}

interface GitHubAnalysisResult {
  status: string;
  analysis: string;
  agent_response?: string;
  branch?: string;
  commit?: string;
  prUrl?: string;
  prNumber?: string;
  prCreated?: boolean;
  error?: string;
}

interface WorkflowRunSummary {
  id: number;
  name: string;
  status: "passed" | "failed";
  bugDetected: boolean;
  sessionId?: string | null;
  createdAt: number;
}

const splitReasonFromText = (text: string): { summaryText: string; reasonText?: string } => {
  const reasonMatch = text.match(/Reason:\s*(.+)$/i);
  return {
    summaryText: reasonMatch ? text.replace(/\s*Reason:\s*.+$/i, "").trim() : text,
    reasonText: reasonMatch?.[1]?.trim(),
  };
};

const extractIssueFromAnalysis = (analysisText: string): string => {
  const normalized = analysisText.replace(/\s+/g, " ").trim();
  const rootCauseMatch = normalized.match(/root cause[^.]*\./i);
  if (rootCauseMatch?.[0]) return rootCauseMatch[0];

  const bugMatch = normalized.match(/bug[^.]*\./i);
  if (bugMatch?.[0]) return bugMatch[0];

  return "a workflow bug identified from the QA session logs";
};

const sanitizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const clampPercent = (value: number): number => Math.max(2, Math.min(98, value));

const normalizeToPercent = (value: unknown): number | null => {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const normalized = value <= 1 ? value * 100 : (value / 1000) * 100;
  return clampPercent(normalized);
};

const getCursorPositionFromAction = (
  functionName?: string,
  args?: Record<string, any>,
): { x: number; y: number } | null => {
  if (!functionName) return null;

  // Try primary x/y coordinates first (used by click_at, type_text_at, hover_at)
  const x = normalizeToPercent(args?.x);
  const y = normalizeToPercent(args?.y);
  if (x !== null && y !== null) {
    return { x, y };
  }

  // Try destination coordinates (used by drag operations)
  const destinationX = normalizeToPercent(args?.destination_x);
  const destinationY = normalizeToPercent(args?.destination_y);
  if (destinationX !== null && destinationY !== null) {
    return { x: destinationX, y: destinationY };
  }

  // Fallback positions for actions without explicit coordinates
  const fallbackPositions: Record<string, { x: number; y: number }> = {
    navigate: { x: 20, y: 8 },
    open_web_browser: { x: 50, y: 48 },
    scroll_document: { x: 50, y: 72 },
    scroll_at: { x: 50, y: 72 },
    wait_5_seconds: { x: 50, y: 50 },
    search: { x: 50, y: 15 },
  };

  return fallbackPositions[functionName] || { x: 50, y: 50 };
};

export default function Home() {
  const backendHttpBase = sanitizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_HTTP_URL || "http://localhost:8080");
  const backendWsBase = sanitizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:8080");
  const [prompt, setPrompt] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [appName, setAppName] = useState("");
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [isGitHubConnected, setIsGitHubConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ type: string; content: string; timestamp: Date; stepNumber?: number; stepTitle?: string; functionName?: string }>>([]);
  const [stepCounter, setStepCounter] = useState(0);
  const [currentUrl, setCurrentUrl] = useState("");
  const [turnNumber, setTurnNumber] = useState(0);
  const [showExecution, setShowExecution] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState("0:00");
  const [activeBugs, setActiveBugs] = useState<Array<{id: number; row: number; col: number; bug: string; color: string}>>([]);
  const [isListening, setIsListening] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<GitHubAnalysisResult | null>(null);
  const [showAgentThoughtLogs, setShowAgentThoughtLogs] = useState(false);
  const [isWorkspaceActive, setIsWorkspaceActive] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [currentWorkflowName, setCurrentWorkflowName] = useState("");
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [codeFixCount, setCodeFixCount] = useState(0);
  const [fixedSessionIds, setFixedSessionIds] = useState<string[]>([]);
  const [workflowCounter, setWorkflowCounter] = useState(1);
  const [workflowCompleted, setWorkflowCompleted] = useState(false);
  const [lastWorkflowStatus, setLastWorkflowStatus] = useState<"passed" | "failed" | null>(null);
  const [bugDescription, setBugDescription] = useState<string>("");
  const [accessibilitySuggestions, setAccessibilitySuggestions] = useState<string[]>([]);
  const [showAgentSteps, setShowAgentSteps] = useState(false);
  const [liveAgentUpdate, setLiveAgentUpdate] = useState("Waiting for model updates...");
  const [agentCursor, setAgentCursor] = useState<{ x: number; y: number; visible: boolean }>({
    x: 50,
    y: 50,
    visible: false,
  });
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const rotatingTitles = ["Super Engineer", "Teammate"];
  const [titleIndex, setTitleIndex] = useState(0);
  const agentStepsScrollRef = useRef<HTMLDivElement>(null);
  const [titleVisible, setTitleVisible] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const parseGitHubAnalysis = (result: any): GitHubAnalysisResult => {
    const analysisText = result?.analysis || result?.agent_response || "";
    const branchMatch = analysisText.match(/Branch:\s*([^\n]+)/i);
    const commitMatch = analysisText.match(/Commit:\s*([^\n]+)/i);
    const prLineMatch = analysisText.match(/PR:\s*(https?:\/\/[^\s\n]+)/i);
    const prUrlMatch = analysisText.match(/https:\/\/github\.com\/[^\s\n]+\/pull\/\d+/i);
    const prNumberMatch = analysisText.match(/PR\s*#\s*(\d+)/i);
    const commitHashMatch = analysisText.match(/\b[0-9a-f]{40}\b/i) || analysisText.match(/\b[0-9a-f]{7,40}\b/i);
    const derivedPrUrl = prNumberMatch?.[1]
      ? `https://github.com/${repoOwner.trim()}/${repoName.trim()}/pull/${prNumberMatch[1]}`
      : undefined;
    const resolvedPrUrl = prLineMatch?.[1]?.trim() || prUrlMatch?.[0] || derivedPrUrl;

    return {
      status: result?.status || "unknown",
      analysis: analysisText || "No analysis returned",
      agent_response: result?.agent_response,
      branch: branchMatch?.[1]?.trim(),
      commit: commitMatch?.[1]?.trim() || commitHashMatch?.[0],
      prUrl: resolvedPrUrl,
      prNumber: prNumberMatch?.[1],
      prCreated: Boolean(resolvedPrUrl || prNumberMatch?.[1]),
      error: result?.error,
    };
  };

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const playAudioFromBase64 = async (base64Audio: string) => {
    if (isVoiceMuted || !base64Audio) {
      console.log('Audio skipped:', { isVoiceMuted, hasAudio: !!base64Audio });
      return;
    }
    
    console.log('Received audio data, length:', base64Audio.length);
    
    // Add to queue
    audioQueueRef.current.push(base64Audio);
    
    // If already playing, the queue will be processed when current audio finishes
    if (isPlayingRef.current) return;
    
    // Process queue
    const processQueue = async () => {
      while (audioQueueRef.current.length > 0) {
        isPlayingRef.current = true;
        const audioData = audioQueueRef.current.shift()!;
        
        try {
          // Convert base64 to blob
          const binaryString = atob(audioData);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          
          console.log('Playing audio, blob size:', blob.size);
          
          // Play audio
          const audio = new Audio(url);
          audio.volume = 1.0;
          
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => {
              console.log('Audio playback ended');
              URL.revokeObjectURL(url);
              resolve();
            };
            audio.onerror = (e) => {
              console.error('Audio element error:', e);
              URL.revokeObjectURL(url);
              reject(e);
            };
            audio.play().then(() => {
              console.log('Audio play() succeeded');
            }).catch((err) => {
              console.error('Audio play() failed:', err);
              reject(err);
            });
          });
        } catch (error) {
          console.error('Audio playback error:', error);
        }
      }
      isPlayingRef.current = false;
    };
    
    processQueue();
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  useEffect(() => {
    const switchInterval = setInterval(() => {
      setTitleVisible(false);

      const swapTimeout = setTimeout(() => {
        setTitleIndex((prev) => (prev + 1) % rotatingTitles.length);
        setTitleVisible(true);
      }, 300);

      return () => clearTimeout(swapTimeout);
    }, 3600);

    return () => clearInterval(switchInterval);
  }, [rotatingTitles.length]);

  useEffect(() => {
    // Initialize Web Speech API
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setPrompt(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      alert('Voice input is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  useEffect(() => {
    if (!sessionStartTime) return;
    
    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - sessionStartTime.getTime()) / 1000);
      const minutes = Math.floor(diff / 60);
      const seconds = diff % 60;
      setElapsedTime(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  // Animated bug grid
  useEffect(() => {
    const bugs = [
      { bug: 'Image aspect ratio broken' },
      { bug: 'Z-index stacking issues' },
      { bug: 'Missing hover states' },
      { bug: 'Modal overlay gaps' },
      { bug: 'Input placeholder style' },
      { bug: 'Button alignment off' },
    ];
    const highlightColors = [
      'bg-red-100/45 text-red-700/85',
      'bg-red-50/60 text-red-600/75',
    ];
    let highlightIndex = 0;

    const interval = setInterval(() => {
      for (let i = 0; i < 2; i += 1) {
        const randomBug = bugs[Math.floor(Math.random() * bugs.length)];
        const color = highlightColors[highlightIndex % highlightColors.length];
        highlightIndex += 1;
        let randomRow = Math.floor(Math.random() * 12);
        let randomCol = Math.floor(Math.random() * 12);

        // Keep second row unlit and avoid center area (rows 3-9, cols 2-9) where text is displayed
        while (randomRow === 1 || (randomRow >= 3 && randomRow <= 9 && randomCol >= 2 && randomCol <= 9)) {
          randomRow = Math.floor(Math.random() * 12);
          randomCol = Math.floor(Math.random() * 12);
        }

        const id = Date.now() + i;

        setActiveBugs(prev => [...prev, { id, row: randomRow, col: randomCol, ...randomBug, color }]);

        setTimeout(() => {
          setActiveBugs(prev => prev.filter(b => b.id !== id));
        }, 4200);
      }
    }, 1400);

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll Agent Steps panel when new logs are added
  useEffect(() => {
    if (agentStepsScrollRef.current && showAgentSteps) {
      agentStepsScrollRef.current.scrollTop = agentStepsScrollRef.current.scrollHeight;
    }
  }, [logs, showAgentSteps]);

  const addLog = (type: string, content: string) => {
    setLogs((prev) => {
      let stepNumber: number | undefined;
      let stepTitle: string | undefined;
      let functionName: string | undefined;

      if (type === "action") {
        stepNumber = prev.filter((log) => log.type === "action").length + 1;
        setStepCounter(stepNumber);

        const match = content.match(/Executing: (\w+)/);
        if (match) {
          functionName = match[1];
          const titleMap: Record<string, string> = {
            navigate: "Navigate",
            click_at: "Click",
            type_text_at: "Type Text",
            wait_5_seconds: "Wait 5 Seconds",
            scroll_document: "Scroll",
            hover_at: "Hover",
            open_web_browser: "Open Browser",
            search: "Search",
          };
          stepTitle = titleMap[functionName] || functionName;
        }
      }

      return [...prev, { type, content, timestamp: new Date(), stepNumber, stepTitle, functionName }];
    });
  };

  const ensureWorkspace = (): boolean => {
    console.log('ensureWorkspace called - appUrl:', appUrl, 'appName:', appName, 'isWorkspaceActive:', isWorkspaceActive);
    if (!appUrl.trim() || !appName.trim()) {
      alert("Please provide App Name and App URL to launch a workspace.");
      return false;
    }

    if (!isWorkspaceActive) {
      console.log('Activating workspace...');
      setIsWorkspaceActive(true);
      setWorkspaceName(repoName.trim());
      setShowExecution(true);
      setSessionStartTime(new Date());
      setElapsedTime("0:00");
      setWorkflowRuns([]);
      setCodeFixCount(0);
      setFixedSessionIds([]);
      setLogs([]);
      setCurrentWorkflowName("");
    } else if (!sessionStartTime) {
      setSessionStartTime(new Date());
    }

    return true;
  };

  const runWorkflow = async (workflowText: string) => {
    const workflowName = workflowText.trim();
    console.log('runWorkflow called with:', workflowName);
    if (!workflowName) return;
    const fullPrompt = `First, navigate to ${appUrl.trim()}. Then, ${workflowName}`;

    // Increment counter when starting new workflow
    if (workflowCompleted) {
      setWorkflowCounter(prev => prev + 1);
      setWorkflowCompleted(false);
      setLastWorkflowStatus(null);
      setBugDescription("");
      setAccessibilitySuggestions([]);
    }

    setIsRunning(true);
    setShowExecution(true);
    setCurrentWorkflowName(workflowName);
    setLogs([]);
    setScreenshot(null);
    setCurrentUrl("");
    setTurnNumber(0);
    setAnalysisResult(null);
    setShowAgentThoughtLogs(false);
    setLiveAgentUpdate("Waiting for model updates...");
    setAgentCursor({ x: 50, y: 50, visible: false });
    setShowAgentSteps(true); // Toggle to Agent Steps panel
    let runSessionId: string | null = null;

    const ws = new WebSocket(`${backendWsBase}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      addLog("status", "Computer Use Activated");
      console.log('[ACCESSIBILITY DEBUG] Sending to backend:', { accessibility_enabled: true });
      ws.send(JSON.stringify({ 
        prompt: fullPrompt,
        client_id: "default",  // Must match CLIENT_ID in local playwright_client.py
        accessibility_enabled: true
      }));
    };

    ws.onmessage = (event) => {
      const message: Message = JSON.parse(event.data);

      switch (message.type) {
        case "session_id":
          if (message.session_id) {
            runSessionId = message.session_id;
            setSessionId(message.session_id);
          }
          break;

        case "screenshot":
          if (message.data) {
            setScreenshot(`data:image/png;base64,${message.data}`);
          }
          break;

        case "thinking":
          if (message.content) {
            addLog("thinking", message.content);
          }
          break;

        case "action":
          if (message.content) {
            addLog("action", message.content);
          }
          {
            const nextPosition = getCursorPositionFromAction(message.function_name, message.args);
            setAgentCursor({
              x: nextPosition?.x ?? 50,
              y: nextPosition?.y ?? 50,
              visible: true,
            });
          }
          break;

        case "status":
          if (message.content) {
            addLog("status", message.content);
          }
          break;

        case "error":
          if (message.content) {
            addLog("error", message.content);
            setLiveAgentUpdate("Hit an issue while testing this flow.");
          }
          break;

        case "benji_thinking":
          if (message.content) {
            setLiveAgentUpdate(message.content);
            console.log('Benji thinking message received:', { 
              content: message.content, 
              hasAudio: !!(message as any).audio,
              audioLength: (message as any).audio?.length 
            });
            // Play audio if available
            if ((message as any).audio) {
              playAudioFromBase64((message as any).audio);
            } else {
              console.warn('No audio data in benji_thinking message');
            }
          }
          break;

        case "turn":
          if (message.turn_number !== undefined) {
            setTurnNumber(message.turn_number);
          }
          if (message.url) {
            setCurrentUrl(message.url);
          }
          break;

        case "complete":
          if (message.content) {
            const verdictText = message.content.toLowerCase();
            const isPassed = verdictText.includes("test passed");
            const isFailed = verdictText.includes("test failed") || verdictText.includes("bug detected");
            if (verdictText.includes("test passed")) {
              addLog(
                "thinking",
                "Final QA summary: TEST PASSED — the workflow reached the expected outcome and UI behavior matched the requirement."
              );
            } else if (verdictText.includes("test failed") || verdictText.includes("bug detected")) {
              addLog(
                "thinking",
                "Final QA summary: TEST FAILED - BUG DETECTED — the workflow did not reach the expected successful outcome."
              );
              
              // Extract bug description if available
              try {
                const bugDescMatch = message.content.match(/bug_explanation["']?\s*:\s*["']([^"']+)["']/);
                if (bugDescMatch && bugDescMatch[1]) {
                  setBugDescription(bugDescMatch[1]);
                } else {
                  setBugDescription("");
                }
              } catch (e) {
                setBugDescription("");
              }
            } else {
              addLog(
                "thinking",
                `Final QA summary: ${message.content}`
              );
            }
            
            // Extract accessibility suggestions (always enabled, for both passed and failed tests)
            console.log('[ACCESSIBILITY DEBUG] Checking message for accessibility suggestions:', message.content);
            try {
              const accessibilityMatch = message.content.match(/accessibility_suggestions["']?\s*:\s*\[([^\]]+)\]/);
              console.log('[ACCESSIBILITY DEBUG] Regex match result:', accessibilityMatch);
              if (accessibilityMatch && accessibilityMatch[1]) {
                const suggestions = accessibilityMatch[1]
                  .split(',')
                  .map(s => s.trim().replace(/^["']|["']$/g, ''))
                  .filter(s => s.length > 0);
                console.log('[ACCESSIBILITY DEBUG] Extracted suggestions:', suggestions);
                setAccessibilitySuggestions(suggestions);
              } else {
                console.log('[ACCESSIBILITY DEBUG] No accessibility_suggestions found in message');
              }
            } catch (e) {
              console.error('[ACCESSIBILITY DEBUG] Error parsing accessibility suggestions:', e);
            }
            
            addLog("complete", message.content);
            
            // Reset session timer and mark workflow as completed
            setSessionStartTime(null);
            setElapsedTime("0:00");
            setWorkflowCompleted(true);
            setLastWorkflowStatus(isPassed ? "passed" : "failed");
            if (isPassed) {
              setBugDescription("");
            }
            setShowAgentSteps(false); // Toggle back to default panel
            setWorkflowRuns((prev) => [
              ...prev,
              {
                id: prev.length + 1,
                name: workflowName,
                status: isPassed ? "passed" : "failed",
                bugDetected: isFailed,
                sessionId: runSessionId || sessionId,
                createdAt: Date.now(),
              },
            ]);
            addLog("status", "Benji Test Lab is ready. Enter the next UI workflow test and click Run Workflow.");
            setPrompt("");
            setLiveAgentUpdate("Test complete. Ready for next workflow.");
          }
          setIsRunning(false);
          break;

        case "safety_prompt":
          if (message.content && message.action) {
            const approved = window.confirm(
              `Safety Prompt: ${message.content}\n\nAllow action: ${message.action}?`
            );
            ws.send(JSON.stringify({ approved }));
          }
          break;
      }
    };

    ws.onerror = (error) => {
      addLog("error", "WebSocket error occurred");
      setIsRunning(false);
    };

    ws.onclose = () => {
      addLog("status", "Ready for next test.");
      setLiveAgentUpdate("Ready for next test.");
      setAgentCursor((prev) => ({ ...prev, visible: false }));
      wsRef.current = null;
      setIsRunning(false);
    };
  };

  const handleRun = async () => {
    if (!ensureWorkspace()) return;
    await runWorkflow(prompt);
  };

  const handleStop = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsRunning(false);
  };

  const handleClose = () => {
    handleStop();
    setIsWorkspaceActive(false);
    setWorkspaceName("");
    setCurrentWorkflowName("");
    setWorkflowRuns([]);
    setCodeFixCount(0);
    setFixedSessionIds([]);
    setSessionId(null);
    setAnalysisResult(null);
    setShowAgentThoughtLogs(false);
    setLiveAgentUpdate("Waiting for model updates...");
    setAgentCursor({ x: 50, y: 50, visible: false });
    setShowExecution(false);
    setSessionStartTime(null);
    setElapsedTime("0:00");
  };

  const handleAnalyzeBugs = async () => {
    if (!sessionId) {
      alert("No session available to analyze");
      return;
    }

    if (!repoOwner.trim() || !repoName.trim()) {
      alert("Please provide repository owner and repository name on the main page.");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);
    setAnalysisPhase("Starting GitHub MCP analysis...");
    setShowAgentThoughtLogs(false);

    try {
      setAnalysisPhase("Sending session logs to GitHub agent...");
      const response = await fetch(`${backendHttpBase}/analyze-bugs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: sessionId,
          repo_owner: repoOwner.trim(),
          repo_name: repoName.trim(),
          app_url: appUrl || window.location.origin,
        }),
      });

      setAnalysisPhase("GitHub agent is finalizing output...");
      const result = await response.json();

      if (response.ok) {
        setAnalysisPhase("Completed");
        const parsed = parseGitHubAnalysis(result);
        setAnalysisResult(parsed);
        if (parsed.prCreated && sessionId) {
          setFixedSessionIds((prev) => {
            if (prev.includes(sessionId)) return prev;
            setCodeFixCount((count) => count + 1);
            return [...prev, sessionId];
          });
        }
      } else {
        setAnalysisPhase("Failed");
        setAnalysisResult({
          status: "failed",
          analysis: "",
          error: result.detail || "Unknown error",
        });
      }
    } catch (error) {
      setAnalysisPhase("Failed");
      setAnalysisResult({
        status: "failed",
        analysis: "",
        error: String(error),
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case "thinking":
        return "🤔";
      case "action":
        return "⚡";
      case "error":
        return "❌";
      case "complete":
        return "✅";
      case "status":
        return "ℹ️";
      default:
        return "•";
    }
  };

  const getLogColor = (type: string) => {
    switch (type) {
      case "thinking":
        return "text-black";
      case "action":
        return "text-black";
      case "error":
        return "text-black";
      case "complete":
        return "text-black";
      case "status":
        return "text-gray-700";
      default:
        return "text-black";
    }
  };

  const getLogBackground = (content: string) => {
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes("test failed") || lowerContent.includes("bug detected")) {
      return "bg-red-50 border-red-300";
    }
    if (lowerContent.includes("test passed") || lowerContent.includes("validated successfully")) {
      return "bg-green-50 border-green-300";
    }
    return "bg-gray-50 border-gray-300";
  };

  const workflowsTested = workflowRuns.length;
  const passedWorkflows = workflowRuns.filter((run) => run.status === "passed").length;
  const failedWorkflows = workflowsTested - passedWorkflows;
  const bugsFound = workflowRuns.filter((run) => run.bugDetected).length;
  const progressPercent = workflowsTested === 0 ? 0 : Math.round((passedWorkflows / workflowsTested) * 100);

  if (!showExecution) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Top Banner */}
        <div className="bg-[#FF0000] text-white px-6 py-3 text-sm flex-shrink-0">
          <div className="max-w-7xl mx-auto flex items-center gap-2">
            <span>Powered by Gemini Computer Use + Gemini Live + Cloud Run</span>
            <span className="ml-auto text-xs">2026</span>
          </div>
        </div>

        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src="/benji_pixel.png" 
                alt="Benji" 
                className="h-8"
              />
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800">
                View Benji on Github
              </button>
            </div>
          </div>
        </header>

        {/* Main Content with Grid Background */}
        <div className="relative bg-gray-50">
          {/* Animated Grid Background */}
          <div className="absolute inset-0 grid gap-0" style={{gridTemplateColumns: 'repeat(12, 1fr)', gridTemplateRows: 'repeat(12, minmax(95px, 1fr))'}}>
            {Array.from({ length: 144 }).map((_, i) => {
              const row = Math.floor(i / 12);
              const col = i % 12;
              const activeBug = activeBugs.find(b => b.row === row && b.col === col);
              
              return (
                <div
                  key={i}
                  className={`border border-gray-100 transition-all duration-500 ${
                    activeBug ? `${activeBug.color} border-transparent` : 'bg-white'
                  }`}
                >
                  {activeBug && (
                    <div className="p-2 h-full flex items-center justify-center">
                      <div className="text-[10px] font-medium text-center leading-tight">
                        ■ {activeBug.bug}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Content Overlay */}
          <div className="relative z-10 flex flex-col items-center px-12 pt-28 pb-36">
            {/* Main Heading */}
            <div className="text-center mb-16 max-w-5xl">
              <div className="-mt-2 mb-3 flex justify-center">
                <Image
                  src="/agentic_cursor.png"
                  alt="Agentic cursor"
                  width={220}
                  height={220}
                  className="h-40 w-40 object-contain md:h-52 md:w-52"
                  priority
                />
              </div>
              <h1 className="text-7xl font-normal mb-6 tracking-tight" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                <span className="text-gray-800">Benji</span> is your AI{" "}
                <span className={`inline-block transition-opacity duration-300 ${titleVisible ? "opacity-100" : "opacity-0"}`}>
                  {rotatingTitles[titleIndex]}
                </span>
              </h1>
              <div className="flex items-center justify-center gap-3 mb-6">
                <span className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-md text-xs font-semibold">
                  Gemini computer use
                </span>
                <span className="px-3 py-1.5 bg-red-100 text-red-700 rounded-md text-xs font-semibold">
                  GitHub ADK MCP
                </span>
              </div>
              <div className="relative mx-auto w-full max-w-5xl overflow-hidden border border-amber-200/90 bg-amber-50/95 shadow-md">
                <div
                  className="absolute inset-0 opacity-50"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px)",
                    backgroundSize: "26px 26px",
                  }}
                />
                <div className="relative z-10 grid gap-8 p-6 md:grid-cols-2 md:p-8">
                  <div className="text-left">
                    <div className="mb-3 inline-flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF0000]" />
                      Benji Test Surface
                    </div>
                    <p className="text-2xl font-medium leading-tight text-[#FF0000] md:text-3xl" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                      Build and ship with more confidence
                    </p>
                    <p className="mt-3 text-sm text-gray-700 md:text-base">
                      Benji tests real UI workflows, catches visual bugs, and writes fixes directly in code.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium">
                      <span className="border border-gray-300 bg-white px-2.5 py-1 text-gray-700">Runs real workflows</span>
                      <span className="border border-gray-300 bg-white px-2.5 py-1 text-gray-700">Finds UI regressions</span>
                      <span className="border border-gray-300 bg-white px-2.5 py-1 text-gray-700">Suggests code fixes</span>
                      <span className="border border-gray-300 bg-white px-2.5 py-1 text-gray-700">Opens PR-ready changes</span>
                    </div>
                  </div>

                  <div className="relative min-h-[220px] md:min-h-[250px]">
                    <div className="absolute left-6 top-6 w-[74%] border border-gray-300 bg-white/95 p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-500">
                        <span>Live Test Board</span>
                        <span className="bg-red-100 px-2 py-0.5 text-red-700">Active</span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between border border-gray-200 bg-gray-50 px-2 py-1">
                          <span>Login flow</span>
                          <span className="bg-green-100 px-2 py-0.5 text-green-700">Pass</span>
                        </div>
                        <div className="flex items-center justify-between border border-gray-200 bg-gray-50 px-2 py-1">
                          <span>Checkout flow</span>
                          <span className="bg-red-100 px-2 py-0.5 text-red-700">Fail</span>
                        </div>
                        <div className="flex items-center justify-between border border-gray-200 bg-gray-50 px-2 py-1">
                          <span>Task creation</span>
                          <span className="bg-amber-100 px-2 py-0.5 text-amber-700">Review</span>
                        </div>
                      </div>
                    </div>

                    <div className="absolute right-2 top-2 border border-red-200 bg-red-50/95 px-3 py-2 text-xs text-red-700 shadow-sm">
                      Modal overflow bug
                    </div>
                    <div className="absolute right-0 top-20 border border-blue-200 bg-blue-50/95 px-3 py-2 text-xs text-blue-700 shadow-sm">
                      PR opened
                    </div>
                    <div className="absolute bottom-3 right-6 border border-green-200 bg-green-50/95 px-3 py-2 text-xs text-green-700 shadow-sm">
                      2 fixes proposed
                    </div>
                    <div className="absolute bottom-0 left-0 border border-gray-300 bg-white/95 px-3 py-2 text-xs text-gray-700 shadow-sm">
                      12 workflows run
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Benji Browser Input Box - Mac Dialog Style */}
            <div className="max-w-5xl w-full mb-40 rounded-none bg-gradient-to-br from-[#ff8d8d] via-[#FF5C5C] to-[#FF0000] p-1.5 shadow-2xl">
              <div className="overflow-hidden rounded-none border border-black/10 bg-[#f6f6f6]">
                <div className="flex items-center gap-2 border-b border-black/10 bg-[#ececec] px-6 py-3">
                  <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                  <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                  <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                  <span className="ml-4 text-xs font-medium tracking-wide text-gray-500">Benji Test Lab</span>
                </div>
                <div className="space-y-4 p-6">
                  <div>
                    <label htmlFor="app-name" className="mb-2 inline-block bg-black px-3 py-1 text-xs font-medium text-white" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                      App Name
                    </label>
                    <input
                      id="app-name"
                      title="App Name"
                      type="text"
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      placeholder="e.g., My Todo App"
                      className="w-full rounded-md border border-gray-300 bg-white px-6 py-3 text-base focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF0000]"
                      style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}
                    />
                  </div>

                  <div>
                    <label htmlFor="app-url" className="mb-2 inline-block bg-black px-3 py-1 text-xs font-medium text-white" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                      App URL
                    </label>
                    <input
                      id="app-url"
                      title="App URL"
                      type="url"
                      value={appUrl}
                      onChange={(e) => setAppUrl(e.target.value)}
                      placeholder="http://localhost:3000"
                      className="w-full rounded-md border border-gray-300 bg-white px-6 py-3 text-base focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF0000]"
                      style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}
                    />
                  </div>

                  <button
                    onClick={handleRun}
                    disabled={!appUrl.trim() || !appName.trim() || isRunning}
                    className="w-full rounded-md bg-[#FF0000] px-10 py-4 text-lg font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}
                  >
                    Launch New Workspace →
                  </button>
                  {isListening && (
                    <div className="flex items-center gap-2 text-sm text-[#FF0000]">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-[#FF0000]"></div>
                      <span>Listening...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* How Benji Works Section - Plain Background */}
        <div className="bg-white py-24">
          <div className="max-w-7xl mx-auto px-12">
            {/* Info Panel with Video */}
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-16">
              <div className="grid grid-cols-2 gap-16 items-start">
                {/* Left: Description */}
                <div className="flex flex-col justify-center h-full">
                  <h3 className="text-4xl font-semibold mb-6" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                    How Benji Works
                  </h3>
                  <p className="text-gray-600 text-lg leading-relaxed mb-8">
                    Watch Benji work in real-time with Gemini Computer Use to navigate UI workflows in your app, spot bugs, reason intelligently, and suggest code fixes like a teammate.
                  </p>
                  <ul className="space-y-4 text-gray-600 text-lg">
                    <li className="flex items-start gap-3">
                      <span className="text-[#FF0000] mt-1 text-xl">✓</span>
                      <span>Automatically navigates complex UI workflows</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-[#FF0000] mt-1 text-xl">✓</span>
                      <span>Detects visual bugs and UI inconsistencies</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-[#FF0000] mt-1 text-xl">✓</span>
                      <span>Provides intelligent code fix suggestions</span>
                    </li>
                  </ul>
                </div>

                {/* Right: Video Placeholder */}
                <div className="bg-gradient-to-br from-purple-100 to-red-100 rounded-2xl flex items-center justify-center border-2 border-dashed border-gray-300" style={{minHeight: '600px'}}>
                  <div className="text-center">
                    <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                      <svg className="w-12 h-12 text-[#FF0000]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                    <p className="text-gray-500 font-medium text-xl">Demo Video</p>
                    <p className="text-sm text-gray-400">Coming Soon</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Text */}
            <div className="text-center mt-20">
              <p className="text-lg text-gray-500 font-light">
                Trusted by <span className="font-semibold text-gray-700">QA Teams</span> at top tech companies
              </p>
            </div>
          </div>
        </div>
        {/* Footer */}
        <footer className="bg-gray-800 text-white py-4 flex-shrink-0">
          <div className="max-w-7xl mx-auto px-6 text-center text-sm">
            Built for the Gemini Live Agents Challenge 2026
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <img 
            src="/benji_pixel.png" 
            alt="Benji" 
            className="h-16 relative -my-4"
          />
          <div className="flex items-center gap-2 ml-24">
            <span className="text-gray-600 text-sm font-medium">Testing Workspace</span>
            <div className="bg-gray-100 rounded px-2.5 py-1">
              <span className="text-[#FF0000] text-sm font-medium">{appName || "My App"}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={() => setShowGitHubModal(true)}
            className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-900 flex items-center gap-2"
          >
            {isGitHubConnected ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Agent Connected to Github Repo
              </>
            ) : (
              <>
                Connect Agent to Github Repo
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-900 rounded-md hover:bg-gray-200 flex items-center gap-2 border border-gray-300"
          >
            Close Workspace
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* GitHub Analysis Modal - Shows while analyzing and displays results */}
      {(isAnalyzing || analysisResult) && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            {isAnalyzing ? (
              // Loading state
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <Loader2 className="w-12 h-12 text-[#FF0000] animate-spin" />
                </div>
                <h3 className="text-xl font-semibold mb-2 text-gray-900">Benji is reviewing your code repository</h3>
                <div className="flex justify-center items-center gap-1 mt-4">
                  <div className="w-2 h-2 bg-[#FF0000] rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                  <div className="w-2 h-2 bg-[#FF0000] rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                  <div className="w-2 h-2 bg-[#FF0000] rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                </div>
                {analysisPhase && (
                  <p className="text-sm text-gray-600 mt-4">{analysisPhase}</p>
                )}
              </div>
            ) : analysisResult ? (
              // Results state
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-bold text-gray-900">Analysis Complete</h3>
                  <button
                    onClick={() => setAnalysisResult(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                {analysisResult.prCreated && (
                  <div className="mb-6 rounded-lg border-2 border-green-300 bg-green-50 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <div className="text-lg font-semibold text-green-800">Pull Request Created</div>
                    </div>
                    <div className="text-sm text-green-700 mb-3">GitHub MCP workflow completed branch/commit/PR steps.</div>
                    
                    {analysisResult.prUrl && (
                      <a
                        href={analysisResult.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                      >
                        View Pull Request
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                )}
                
                <div className="space-y-4">
                  {analysisResult.branch && (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-gray-600 mb-1">Branch</div>
                      <div className="text-base text-gray-900 font-mono">{analysisResult.branch}</div>
                    </div>
                  )}
                  
                  {analysisResult.commit && (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-gray-600 mb-1">Commit</div>
                      <div className="text-base text-gray-900 font-mono">{analysisResult.commit}</div>
                    </div>
                  )}
                  
                  {analysisResult.analysis && (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-gray-600 mb-2">Analysis Details</div>
                      <div className="text-sm text-gray-900 whitespace-pre-wrap">{analysisResult.analysis}</div>
                    </div>
                  )}
                </div>
                
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => setAnalysisResult(null)}
                    className="px-6 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* GitHub Connection Modal */}
      {showGitHubModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowGitHubModal(false)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Connect Via Github ADK MCP Tool</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">GitHub Owner</label>
                <input
                  type="text"
                  value={repoOwner}
                  onChange={(e) => setRepoOwner(e.target.value)}
                  placeholder="username or organization"
                  className="w-full px-3 py-2 bg-white border border-gray-300 text-gray-900 rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF0000] placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">Repository Name</label>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="repository-name"
                  className="w-full px-3 py-2 bg-white border border-gray-300 text-gray-900 rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF0000] placeholder-gray-400"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowGitHubModal(false)}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-900 rounded-md hover:bg-gray-200 border border-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (repoOwner.trim() && repoName.trim()) {
                      setIsGitHubConnected(true);
                      setShowGitHubModal(false);
                    }
                  }}
                  disabled={!repoOwner.trim() || !repoName.trim()}
                  className="px-4 py-2 text-sm bg-[#FF0000] text-white rounded-md hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-h-0 px-12 pt-4 pb-12" style={{
        backgroundColor: '#fff5f5',
        backgroundImage: 'linear-gradient(to right, #fecaca 1px, transparent 1px), linear-gradient(to bottom, #fecaca 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }}>
        <div className="flex-1 flex gap-0 max-w-[1400px] mx-auto">
        {/* Left Sidebar - Sliding Panel Container */}
        <div className="w-[380px] relative overflow-hidden flex-shrink-0">
          {/* Default Panel */}
          <div 
            className={`absolute inset-0 bg-gray-50 border border-black flex flex-col overflow-hidden shadow-sm transition-transform duration-500 ease-in-out ${
              showAgentSteps ? '-translate-x-full' : 'translate-x-0'
            }`}
          >
          <div className="bg-gray-50 flex-shrink-0 border-b border-gray-200">
              <div className={`px-6 py-5 shadow-sm relative transition-colors duration-300 ${
                workflowCompleted && lastWorkflowStatus === "passed" 
                  ? "bg-[#16a34a]" 
                  : "bg-[#FF0000]"
              }`}>
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-md font-bold text-lg flex-shrink-0">
                    {currentWorkflowName ? (
                      <div className="w-12 h-12 bg-gray-100 text-red-600 rounded-md flex items-center justify-center">{workflowCounter}</div>
                    ) : <div className="w-12 h-12 bg-gray-100 text-red-600 rounded-md flex items-center justify-center"><MousePointer className="w-6 h-6" /></div>}
                  </div>
                  <div className="text-lg font-semibold tracking-[-0.01em] text-white break-words flex-1">
                    {currentWorkflowName ? currentWorkflowName.charAt(0).toUpperCase() + currentWorkflowName.slice(1) : "Run your first workflow"}
                  </div>
                </div>
                {workflowCompleted && (
                  <div className="absolute bottom-2 right-4 flex items-center gap-2">
                    <span className="text-xs text-white/80 font-medium">Finished testing</span>
                    {lastWorkflowStatus && (
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${lastWorkflowStatus === "passed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {lastWorkflowStatus === "passed" ? "PASS" : "FAIL"}
                      </span>
                    )}
                  </div>
                )}
              </div>

          {/* Analyze & Fix Bugs Section - Only show if workflow failed */}
          {workflowCompleted && lastWorkflowStatus === "failed" && (
            <div className="bg-gray-50 flex-shrink-0 border-b border-gray-200">
              <div className="bg-white px-6 py-4 border-l-4 border-red-500">
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center w-10 h-10 bg-red-100 text-red-600 rounded-md flex-shrink-0 mt-1">
                    {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlertCircle className="w-5 h-5" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-900 font-semibold text-base mb-2">
                      Bug found. Let Benji check & fix the code?
                    </p>
                    {bugDescription && (
                      <div className="mb-3 inline-block bg-red-50 border border-red-200 rounded-md px-3 py-1.5">
                        <p className="text-red-800 text-sm">
                          {bugDescription}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={handleAnalyzeBugs}
                        disabled={!sessionId || isAnalyzing || isRunning}
                        className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
                      >
                        <CheckCircle className="w-4 h-4" />
                        {isAnalyzing ? 'Analyzing...' : 'Accept'}
                      </button>
                      <button
                        onClick={() => {
                          setWorkflowCompleted(false);
                          setLastWorkflowStatus(null);
                          setBugDescription("");
                        }}
                        disabled={isAnalyzing || isRunning}
                        className="px-4 py-2 text-sm bg-gray-100 text-gray-700 border border-gray-300 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                      >
                        <X className="w-4 h-4" />
                        Ignore
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Accessibility Suggestions Section - Only show if there are actual suggestions (not "No accessibility improvement recommendations!") */}
          {accessibilitySuggestions.length > 0 && 
           !accessibilitySuggestions.some(s => s.toLowerCase().includes('no accessibility improvement')) && (
            <div className="bg-gray-50 flex-shrink-0 border-b border-gray-200">
              <div className="bg-[#1a0033] px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm mb-1">
                      Accessibility Suggestions
                    </p>
                    <div className="text-white/90 text-xs">
                      {accessibilitySuggestions.join(' • ')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stats Section - Hide when bug section is visible */}
          {!(workflowCompleted && lastWorkflowStatus === "failed") && (
              <div className="px-4 py-4 flex flex-wrap gap-2 text-xs">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/85 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-slate-500" />
                  <span className="text-slate-600">Workflows</span>
                  <span className="font-semibold text-slate-800">{workflowsTested}</span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-green-300/90 bg-green-50/90 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-green-700">Passed</span>
                  <span className="font-semibold text-green-800">{passedWorkflows}</span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-red-300/90 bg-red-50/90 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  <span className="text-red-700">Failed</span>
                  <span className="font-semibold text-red-800">{failedWorkflows}</span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/90 bg-amber-50/90 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span className="text-amber-700">Bugs</span>
                  <span className="font-semibold text-amber-800">{bugsFound}</span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-300/90 bg-blue-50/90 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="text-blue-700">Code Fixes</span>
                  <span className="font-semibold text-blue-800">{codeFixCount}</span>
                </div>
              </div>
          )}
          </div>
          
          {/* Mic Section - Hide when bug section is visible */}
          {!(workflowCompleted && lastWorkflowStatus === "failed") && (
          <div className="border-b border-gray-200 flex-shrink-0 bg-gray-50">
            <div className="p-5">
              <div className="flex items-center gap-5">
                <button
                  onClick={toggleVoiceInput}
                  disabled={isRunning}
                  className={`flex-shrink-0 transition-all duration-200 ${
                    isListening ? 'scale-105' : 'hover:scale-105'
                  }`}
                  title={isListening ? 'Stop recording' : 'Speak your workflow'}
                >
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 animate-pulse ${
                    isListening
                      ? 'bg-[#FF0000] shadow-lg shadow-red-500/50'
                      : 'bg-[#FF0000] shadow-md'
                  }`}>
                    {isListening ? (
                      <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="4" y="4" width="3" height="16" rx="1.5">
                          <animate attributeName="height" values="16;8;16" dur="1s" repeatCount="indefinite" />
                          <animate attributeName="y" values="4;8;4" dur="1s" repeatCount="indefinite" />
                        </rect>
                        <rect x="10" y="2" width="3" height="20" rx="1.5">
                          <animate attributeName="height" values="20;4;20" dur="1s" begin="0.2s" repeatCount="indefinite" />
                          <animate attributeName="y" values="2;10;2" dur="1s" begin="0.2s" repeatCount="indefinite" />
                        </rect>
                        <rect x="16" y="6" width="3" height="12" rx="1.5">
                          <animate attributeName="height" values="12;6;12" dur="1s" begin="0.4s" repeatCount="indefinite" />
                          <animate attributeName="y" values="6;9;6" dur="1s" begin="0.4s" repeatCount="indefinite" />
                        </rect>
                      </svg>
                    ) : (
                      <Mic className="w-7 h-7 text-white" />
                    )}
                  </div>
                </button>
                
                <div className="flex-1 min-w-0">
                  <div className="bg-white border border-gray-200 rounded-3xl px-6 py-4 shadow-md relative">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2.5 w-5 h-5 bg-white border-l border-b border-gray-200 rotate-45"></div>
                    {prompt ? (
                      <div>
                        <p className="text-sm text-gray-500 mb-1">Workflow to validate:</p>
                        <p className="text-base font-medium text-gray-900">{prompt}</p>
                      </div>
                    ) : (
                      <p className="text-base font-medium text-gray-900">
                        {isListening ? 'Listening...' : 'Describe a new workflow you want Benji to validate'}
                      </p>
                    )}
                  </div>
                  {prompt && !isRunning && (
                    <button
                      onClick={handleRun}
                      className="mt-3 w-full bg-[#FF0000] text-white px-6 py-3 rounded-xl font-medium hover:bg-red-600 transition-colors shadow-md"
                    >
                      Run Workflow
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}

          <div className="bg-gray-50 p-4 flex-shrink-0">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-3.5 h-3.5 text-gray-500" />
                <h3 className="text-xs text-gray-500 uppercase tracking-wide">Workflow History</h3>
              </div>
              <div className="space-y-2">
                {workflowRuns.length === 0 ? (
                  <div className="text-xs text-gray-400">No workflows run yet.</div>
                ) : (
                  <div className="space-y-2">
                    {workflowRuns.slice().reverse().map((run, index) => {
                      const statusColor = run.status === "passed" ? "border-l-green-500" : "border-l-red-500";
                      return (
                        <div
                          key={run.id}
                          className={`bg-white border-l-4 ${statusColor} p-2 text-xs`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 truncate">{run.name}</div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`px-1.5 py-0.5 text-[10px] rounded ${run.status === "passed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                {run.status === "passed" ? "PASS" : "FAIL"}
                              </span>
                              {run.bugDetected && (
                                <span className="bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 rounded">
                                  BUG
                                </span>
                              )}
                              <button
                                onClick={() => {
                                  setShowAgentSteps(true);
                                }}
                                className="px-2.5 py-1 text-xs text-gray-700 hover:text-gray-900 transition-colors"
                              >
                                View Agent Logs
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
          </div>
          </div>

          {/* Agent Steps Panel */}
          <div 
            className={`absolute inset-0 bg-gray-50 border border-black flex flex-col overflow-hidden shadow-sm transition-transform duration-500 ease-in-out ${
              showAgentSteps ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="p-4 border-b border-gray-200 bg-[#FF0000] flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-white font-bold text-lg">Agent Steps</h2>
                  <p className="text-white/80 text-sm mt-1">See Benji&apos;s step-by-step reasoning</p>
                </div>
                <button
                  onClick={() => setShowAgentSteps(false)}
                  className="text-white hover:bg-white/20 rounded-md p-2 transition-colors"
                  title="Back to main panel"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div ref={agentStepsScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {logs.map((log, index) => {
                // Group thinking logs with their corresponding action card
                if (log.type === 'thinking') {
                  return null;
                }

                // Find associated thinking log
                const thinkingLog = index > 0 && logs[index - 1].type === 'thinking' ? logs[index - 1] : null;

                if (log.stepNumber && log.stepTitle) {
                  // Check if this is a bug/failure step
                  const thinkingLower = thinkingLog?.content.toLowerCase() || '';
                  const isBugStep = thinkingLower.includes('test failed') || thinkingLower.includes('bug detected');
                  const isPassStep = thinkingLower.includes('test passed');
                  const bgColor = isBugStep ? 'bg-[#fff2f2]' : isPassStep ? 'bg-[#f0fff4]' : 'bg-white';
                  const borderColor = isBugStep ? 'border-red-200' : isPassStep ? 'border-green-200' : 'border-gray-200';
                  
                  return (
                    <div key={index} className={`${bgColor} border ${borderColor} rounded-lg overflow-hidden`}>
                      {/* Step Header */}
                      <div className="p-4">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-7 h-7 bg-[#eceff3] text-[#4b5563] font-semibold text-sm flex items-center justify-center flex-shrink-0 border border-[#d9dde3] rounded">
                            {log.stepNumber}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-medium text-base leading-tight tracking-[-0.01em] text-[#222]">{log.stepTitle}</h3>
                          </div>
                        </div>

                        {/* Thinking/Explanation */}
                        {thinkingLog && (
                          <p className="text-sm leading-6 text-[#555] mb-3">
                            {thinkingLog.content}
                          </p>
                        )}

                        {/* ToolCall Section */}
                        {log.functionName && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-[#4b5563]">›</span>
                            <span className="text-[#4b5563]">ToolCall</span>
                            <code className="px-2 py-0.5 bg-[#eceff3] border border-[#d9dde3] text-[#111827] font-mono text-xs rounded">
                              {log.functionName}
                            </code>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                // For other log types (status, error, complete)
                return (
                  <div key={index} className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{log.type === 'error' ? '❌' : log.type === 'complete' ? '✅' : 'ℹ️'}</span>
                      <p className="text-sm text-gray-700">{log.content}</p>
                    </div>
                  </div>
                );
              })}
              {logs.length === 0 && (
                <div className="text-center text-gray-400 mt-8 text-sm">
                  Agent steps will appear here as the workflow runs...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side - Browser View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Overall Browser Container with Border */}
          <div className="flex-1 bg-white border border-l-0 border-black shadow-sm overflow-hidden flex flex-col relative">
            {/* Live Browser View Label - Always visible */}
            <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-full border border-gray-300">
              <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-xs font-medium text-gray-600">Live Browser View</span>
            </div>
            
            {/* Workflow Name Display - Center Top */}
            {currentWorkflowName && isRunning && (
              <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-30 bg-[#FF0000] px-4 py-2 rounded-lg shadow-md">
                <span className="text-sm font-semibold text-white">{currentWorkflowName.charAt(0).toUpperCase() + currentWorkflowName.slice(1)}</span>
              </div>
            )}
            
            <div className="w-full h-full flex items-center justify-center overflow-auto p-8">
            {screenshot ? (
              <div className="max-w-5xl max-h-full mx-auto">
                {/* macOS Browser Chrome */}
                <div className="bg-white shadow-lg">
                  <div className="bg-gradient-to-b from-gray-100 to-gray-50 px-3 py-2 rounded-t-xl border-b border-gray-300 flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-400"></div>
                      <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                      <div className="w-3 h-3 rounded-full bg-green-400"></div>
                    </div>
                    <div className="flex-1 mx-4 bg-white rounded-md px-3 py-1 text-xs text-gray-600 border border-gray-200">
                      {currentUrl || 'about:blank'}
                    </div>
                  </div>
                  <div className="bg-white">
                    <div className="relative">
                      <img
                        src={screenshot}
                        alt="Browser screenshot"
                        className="w-full rounded-b-xl"
                      />
                      {agentCursor.visible && (
                        <div className="pointer-events-none absolute inset-0">
                          <div
                            className="absolute z-20 transition-all duration-500 ease-out"
                            style={{
                              left: `${agentCursor.x}%`,
                              top: `${agentCursor.y}%`,
                              transform: "translate(-50%, -50%)",
                            }}
                          >
                            <div className="relative">
                              {/* Pink circular glow */}
                              <div className="absolute inset-0 -m-6 rounded-full bg-pink-500/20 blur-md"></div>
                              <div className="absolute inset-0 -m-4 rounded-full border border-pink-400/60 animate-pulse"></div>
                              <Image
                                src="/agentic_cursor.png"
                                alt="Agent cursor"
                                width={32}
                                height={32}
                                className="h-8 w-8 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.3)] relative z-10"
                              />
                            </div>
                          </div>
                          <div
                            className="absolute z-10 max-w-[260px] rounded-lg border-2 border-black bg-gradient-to-r from-red-600 to-red-700 px-3 py-2 text-xs font-medium text-white shadow-xl transition-all duration-500 ease-out"
                            style={{
                              left: `${Math.min(agentCursor.x + 4, 75)}%`,
                              top: `${Math.min(agentCursor.y + 3, 84)}%`,
                            }}
                          >
                            <div className="text-xs text-red-100/95 font-semibold">Benji</div>
                            <div className="mt-0.5">{liveAgentUpdate}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative w-full h-full bg-white border border-gray-200 rounded-lg">
              </div>
            )}
            </div>
          </div>

          {/* Bottom Bar - Inside Border */}
          <div className="border-t border-gray-200 px-4 py-3 bg-white flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">Session time: {elapsedTime}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="px-3 py-1 bg-[#FF0000] text-white rounded-md text-xs font-medium">
                {isRunning ? 'Running' : 'Complete'}
              </div>
            </div>
          </div>

          {(isAnalyzing || analysisResult) && (
            <div className="border-t-2 border-red-300 bg-red-50 px-4 py-3 flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <Code className="w-4 h-4 text-red-700" />
                <span className="text-sm font-semibold text-red-800">GitHub Agent Analysis</span>
                {isAnalyzing && <Loader2 className="w-4 h-4 animate-spin text-red-700" />}
              </div>

              {isAnalyzing && (
                <div className="text-sm text-gray-700 mb-2">
                  {analysisPhase || "Running..."}
                </div>
              )}

              {analysisResult && (
                <div className="space-y-2 text-sm">
                  {analysisResult.prCreated && (
                    <div className="rounded-lg border-2 border-green-300 bg-green-50 p-3">
                      <div className="text-base font-semibold text-green-800">✅ Pull Request Created</div>
                      <div className="text-xs text-green-700 mt-1">GitHub MCP workflow completed branch/commit/PR steps.</div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">Status:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        analysisResult.status === "success"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {analysisResult.status}
                    </span>
                  </div>

                  {analysisResult.branch && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600">Branch:</span>
                      <code className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs">
                        {analysisResult.branch}
                      </code>
                    </div>
                  )}

                  {analysisResult.commit && (
                    <div className="rounded-md border border-indigo-200 bg-indigo-50 p-2">
                      <div className="text-xs font-semibold text-indigo-700 mb-1">Commit</div>
                      <code className="px-2 py-1 bg-white border border-indigo-200 rounded text-xs break-all block">
                        {analysisResult.commit}
                      </code>
                    </div>
                  )}

                  {analysisResult.prUrl && (
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-2">
                      <div className="text-xs font-semibold text-blue-700 mb-1">
                        Pull Request {analysisResult.prNumber ? `#${analysisResult.prNumber}` : ""}
                      </div>
                      <a
                        href={analysisResult.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 hover:text-blue-800 underline break-all text-sm font-medium"
                      >
                        {analysisResult.prUrl}
                      </a>
                    </div>
                  )}

                  {analysisResult.error && (
                    <div className="text-red-700 bg-red-50 border border-red-200 rounded p-2">
                      {analysisResult.error}
                    </div>
                  )}

                  {analysisResult.analysis &&
                    (() => {
                      const { summaryText, reasonText } = splitReasonFromText(analysisResult.analysis);
                      const issueSummary = extractIssueFromAnalysis(summaryText);
                      const benjiSummary = analysisResult.prCreated
                        ? `Great — I found the issue and successfully created a pull request. The root issue was ${issueSummary} I implemented the fix, pushed it to branch ${analysisResult.branch ? `"${analysisResult.branch}"` : "for this change"}, and opened ${analysisResult.prUrl ? `PR ${analysisResult.prUrl}` : "a pull request"}${analysisResult.commit ? ` with commit ${analysisResult.commit}.` : "."}`
                        : `I reviewed the logs and found the issue. The root issue was ${issueSummary} I prepared the analysis and next fix steps, but a pull request has not been confirmed yet.`;

                      return (
                        <div className="space-y-2">
                          <div className="bg-white border border-gray-200 rounded p-3 text-sm text-gray-800">
                            {benjiSummary}
                          </div>

                          {reasonText && (
                            <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 whitespace-normal">
                              <span className="font-semibold">Reason:</span> {reasonText}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => setShowAgentThoughtLogs((prev) => !prev)}
                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                          >
                            {showAgentThoughtLogs ? "Hide Agent Thought Logs" : "Show Agent Thought Logs"}
                          </button>

                          {showAgentThoughtLogs && (
                            <div className="max-h-40 overflow-y-auto bg-white border border-gray-200 rounded p-2 text-xs text-gray-700 whitespace-pre-wrap">
                              {summaryText}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
