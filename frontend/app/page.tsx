"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Loader2, AlertCircle, Code, MessageSquare, Gamepad2, TrendingUp, X, Clock, Mic, MicOff } from "lucide-react";

interface Message {
  type: string;
  content?: string;
  data?: string;
  session_id?: string;
  turn_number?: number;
  url?: string;
  action?: string;
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

export default function Home() {
  const backendHttpBase = sanitizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_HTTP_URL || "http://localhost:8080");
  const backendWsBase = sanitizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:8080");
  const [prompt, setPrompt] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
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
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

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

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

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
        setPrompt(prev => prev ? prev + ' ' + transcript : transcript);
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
      { bug: 'Image aspect ratio broken', color: 'bg-purple-100 text-purple-700' },
      { bug: 'Z-index stacking issues', color: 'bg-red-100 text-red-700' },
      { bug: 'Missing hover states', color: 'bg-purple-100 text-purple-700' },
      { bug: 'Modal overlay gaps', color: 'bg-red-100 text-red-700' },
      { bug: 'Input placeholder style', color: 'bg-purple-100 text-purple-700' },
      { bug: 'Button alignment off', color: 'bg-red-100 text-red-700' },
    ];

    const interval = setInterval(() => {
      const randomBug = bugs[Math.floor(Math.random() * bugs.length)];
      let randomRow = Math.floor(Math.random() * 10);
      let randomCol = Math.floor(Math.random() * 16);
      
      // Avoid center area (rows 2-8, cols 3-13) where text is displayed
      while (randomRow >= 2 && randomRow <= 8 && randomCol >= 3 && randomCol <= 13) {
        randomRow = Math.floor(Math.random() * 10);
        randomCol = Math.floor(Math.random() * 16);
      }
      
      const id = Date.now();

      setActiveBugs(prev => [...prev, { id, row: randomRow, col: randomCol, ...randomBug }]);

      setTimeout(() => {
        setActiveBugs(prev => prev.filter(b => b.id !== id));
      }, 3000);
    }, 800);

    return () => clearInterval(interval);
  }, []);

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

  const handleRun = async () => {
    if (!prompt.trim() && !appUrl.trim()) return;
    
    // Construct full prompt with URL if provided
    let fullPrompt = prompt;
    if (appUrl.trim()) {
      fullPrompt = `First, navigate to ${appUrl}. Then, ${prompt}`;
    }
    
    if (!fullPrompt.trim()) return;

    setIsRunning(true);
    setShowExecution(true);
    setLogs([]);
    setScreenshot(null);
    setCurrentUrl("");
    setTurnNumber(0);
    setSessionStartTime(new Date());

    const ws = new WebSocket(`${backendWsBase}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      addLog("status", "Connected to agent");
      ws.send(JSON.stringify({ 
        prompt: fullPrompt,
        client_id: "default"  // Must match CLIENT_ID in local playwright_client.py
      }));
    };

    ws.onmessage = (event) => {
      const message: Message = JSON.parse(event.data);

      switch (message.type) {
        case "session_id":
          if (message.session_id) {
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
          break;

        case "status":
          if (message.content) {
            addLog("status", message.content);
          }
          break;

        case "error":
          if (message.content) {
            addLog("error", message.content);
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
            } else {
              addLog(
                "thinking",
                `Final QA summary: ${message.content}`
              );
            }
            addLog("complete", message.content);
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
      addLog("status", "Disconnected from agent");
      setIsRunning(false);
    };
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
        setAnalysisResult(parseGitHubAnalysis(result));
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

  if (!showExecution) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Top Banner */}
        <div className="bg-[#FF0000] text-white px-6 py-3 text-sm flex-shrink-0">
          <div className="max-w-7xl mx-auto flex items-center gap-2">
            <span>▶</span>
            <span>Try it out in Stageland! • Get started with the Gemini & Flash template</span>
            <span className="ml-auto text-xs">Learn more →</span>
          </div>
        </div>

        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#FF0000] rounded flex items-center justify-center text-white font-bold text-sm">
                B
              </div>
              <span className="font-semibold text-lg">Benji Browser</span>
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                Deploy
              </button>
              <button className="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800">
                GitHub
              </button>
            </div>
          </div>
        </header>

        {/* Main Content with Grid Background */}
        <div className="relative bg-gray-50">
          {/* Animated Grid Background */}
          <div className="absolute inset-0 grid gap-0" style={{gridTemplateColumns: 'repeat(16, 1fr)', gridTemplateRows: 'repeat(10, minmax(80px, 1fr))'}}>
            {Array.from({ length: 160 }).map((_, i) => {
              const row = Math.floor(i / 16);
              const col = i % 16;
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
          <div className="relative z-10 flex flex-col items-center px-12 py-48">
            {/* Main Heading */}
            <div className="text-center mb-24 max-w-5xl">
              <h1 className="text-7xl font-normal mb-6 tracking-tight" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                Benji is your AI Super Engineer
              </h1>
              <div className="flex items-center justify-center gap-3 mb-6">
                <span className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-md text-xs font-semibold uppercase tracking-wide">
                  QA Guide
                </span>
                <p className="text-gray-600 text-xl font-light">
                  Visual UI bugs are everywhere
                </p>
              </div>
              <p className="text-gray-500 text-base max-w-2xl mx-auto font-light">
                Common visual defects that slip through code review
              </p>
            </div>

            {/* Benji Browser Input Box - Full Width */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 max-w-5xl w-full mb-40">
              <div className="space-y-4">
                {/* URL Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                    Go to:
                  </label>
                  <input
                    type="url"
                    value={appUrl}
                    onChange={(e) => setAppUrl(e.target.value)}
                    placeholder="http://localhost:3000/"
                    className="w-full px-6 py-3 text-base border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF0000] focus:border-transparent"
                    style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}
                  />
                </div>

                {/* Repository Inputs */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="github-owner" className="block text-sm font-medium text-gray-700 mb-2" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                      GitHub Owner:
                    </label>
                    <input
                      id="github-owner"
                      title="GitHub Owner"
                      type="text"
                      value={repoOwner}
                      onChange={(e) => setRepoOwner(e.target.value)}
                      className="w-full px-4 py-3 text-base border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF0000] focus:border-transparent"
                      style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}
                    />
                  </div>
                  <div>
                    <label htmlFor="github-repository" className="block text-sm font-medium text-gray-700 mb-2" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                      Repository:
                    </label>
                    <input
                      id="github-repository"
                      title="Repository"
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      className="w-full px-4 py-3 text-base border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF0000] focus:border-transparent"
                      style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}
                    />
                  </div>
                </div>

                {/* Workflow Description Input */}
                <div className="flex items-center gap-4">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleRun()}
                      placeholder="Describe your UI test workflow..."
                      className="w-full px-6 py-4 pr-14 text-lg border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF0000] focus:border-transparent"
                      style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}
                    />
                    <button
                      onClick={toggleVoiceInput}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors ${
                        isListening 
                          ? 'bg-red-100 text-[#FF0000] animate-pulse' 
                          : 'hover:bg-gray-100 text-gray-500'
                      }`}
                      title={isListening ? 'Stop recording' : 'Start voice input'}
                    >
                      {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                  </div>
                  <button
                    onClick={handleRun}
                    disabled={!prompt.trim() && !appUrl.trim()}
                    className="px-10 py-4 bg-[#FF0000] text-white rounded-xl text-lg font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                    style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}
                  >
                    Run →
                  </button>
                </div>
                {isListening && (
                  <div className="flex items-center gap-2 text-sm text-[#FF0000]">
                    <div className="w-2 h-2 bg-[#FF0000] rounded-full animate-pulse"></div>
                    <span>Listening...</span>
                  </div>
                )}
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
            Powered by <span className="text-[#FF0000] font-semibold">Browserbase</span> & <span className="text-[#FF0000] font-semibold">Stageland</span>
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
          <div className="w-7 h-7 bg-[#FF0000] rounded flex items-center justify-center text-white font-bold text-xs">
            B
          </div>
          <span className="font-semibold">Benji Browser</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleAnalyzeBugs}
            disabled={!sessionId || isAnalyzing || isRunning}
            className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Code className="w-4 h-4" />
                Analyze & Fix Bugs
              </>
            )}
          </button>
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2"
          >
            Close <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-h-0 gap-4 p-4">
        {/* Left Sidebar - Steps */}
        <div className="w-[420px] bg-[#f7f7f7] border border-gray-200 flex flex-col overflow-hidden shadow-sm flex-shrink-0">
          <div className="p-6 border-b border-gray-200 bg-[#efebf8] flex-shrink-0">
            <div className="text-[20px] leading-[1.45] font-normal text-[#222] tracking-[-0.01em]">{prompt}</div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                  <div key={index} className={`${bgColor} border ${borderColor} overflow-hidden`}>
                    {/* Step Header */}
                    <div className="p-6">
                      <div className="flex items-start gap-3 mb-4">
                        <div className="w-7 h-7 bg-[#eceff3] text-[#4b5563] font-semibold text-sm flex items-center justify-center flex-shrink-0 border border-[#d9dde3]">
                          {log.stepNumber}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium text-lg leading-tight tracking-[-0.01em] text-[#222]">{log.stepTitle}</h3>
                        </div>
                      </div>

                      {/* Thinking/Explanation */}
                      {thinkingLog && (
                        <p className="text-sm leading-6 text-[#222] mb-4">
                          {thinkingLog.content}
                        </p>
                      )}

                      {/* ToolCall Section */}
                      {log.functionName && (
                        <div className="flex items-center gap-2 text-sm leading-tight">
                          <span className="text-[#4b5563]">›</span>
                          <span className="text-[#4b5563]">ToolCall</span>
                          <code className="px-2 py-0.5 bg-[#eceff3] border border-[#d9dde3] text-[#111827] font-mono text-sm">
                            {log.functionName}
                          </code>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // For status logs - show condensed
              if (log.type === 'status') {
                return (
                  <div key={index} className="flex items-center gap-2 text-sm text-gray-500 px-2">
                    <span>{getLogIcon(log.type)}</span>
                    <span>{log.content}</span>
                  </div>
                );
              }

              // For error and complete logs
              const reasonMatch = log.type === "complete" ? log.content.match(/Reason:\s*(.+)$/i) : null;
              const summaryText = reasonMatch
                ? log.content.replace(/\s*Reason:\s*.+$/i, "").trim()
                : log.content;
              const reasonText = reasonMatch?.[1]?.trim();

              return (
                <div
                  key={index}
                  className={`text-sm p-3 rounded-lg border ${getLogBackground(log.content)}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base">{getLogIcon(log.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="break-words text-sm">{summaryText}</p>
                      {reasonText && (
                        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          <span className="font-semibold">Reason:</span> {reasonText}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {logs.length === 0 && (
              <div className="text-center text-gray-400 mt-8 text-sm">
                Agent steps will appear here
              </div>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Right Side - Browser View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center overflow-auto">
            {screenshot ? (
              <div className="w-full h-full">
                {/* macOS Browser Chrome */}
                <div className="bg-white rounded-t-xl border border-gray-300 shadow-2xl">
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
                    <img
                      src={screenshot}
                      alt="Browser screenshot"
                      className="w-full rounded-b-xl"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400">
                <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin" />
                <p>Launching browser...</p>
              </div>
            )}
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
          
          {/* Bottom Bar */}
          <div className="border-t border-gray-200 px-4 py-3 bg-white flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">Session time: {elapsedTime}</span>
              </div>
              {turnNumber > 0 && (
                <div className="text-gray-500">
                  Turn {turnNumber}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="px-3 py-1 bg-[#FF0000] text-white rounded-md text-xs font-medium">
                {isRunning ? 'Running' : 'Complete'}
              </div>
              <span className="text-xs text-gray-500">Gemini 2.5 Computer Use</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
