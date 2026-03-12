"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Loader2, AlertCircle, Code, MessageSquare, Gamepad2, TrendingUp, X, Clock, Mic, MicOff } from "lucide-react";

interface Message {
  type: string;
  content?: string;
  data?: string;
  turn_number?: number;
  url?: string;
  action?: string;
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [appUrl, setAppUrl] = useState("");
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
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

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
    let stepNumber: number | undefined;
    let stepTitle: string | undefined;
    let functionName: string | undefined;

    if (type === 'action') {
      setStepCounter(prev => {
        stepNumber = prev + 1;
        return prev + 1;
      });
      
      // Extract function name from action content
      const match = content.match(/Executing: (\w+)/);
      if (match) {
        functionName = match[1];
        // Generate step title based on function
        const titleMap: Record<string, string> = {
          'navigate': 'Navigate',
          'click_at': 'Click',
          'type_text_at': 'Type Text',
          'scroll_document': 'Scroll',
          'hover_at': 'Hover',
          'open_web_browser': 'Open Browser',
          'search': 'Search',
        };
        stepTitle = titleMap[functionName] || functionName;
      }
    }

    setLogs((prev) => [...prev, { type, content, timestamp: new Date(), stepNumber, stepTitle, functionName }]);
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

    const ws = new WebSocket("ws://localhost:8080/ws");
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

    const repoOwner = prompt("Enter GitHub repository owner:");
    const repoName = prompt("Enter GitHub repository name:");
    
    if (!repoOwner || !repoName) {
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await fetch("http://localhost:8080/analyze-bugs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: sessionId,
          repo_owner: repoOwner,
          repo_name: repoName,
          app_url: appUrl || window.location.origin,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        alert(`Bug Analysis Complete!\n\nStatus: ${result.status}\n\nAnalysis:\n${result.analysis}`);
      } else {
        alert(`Analysis failed: ${result.detail || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Error: ${error}`);
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
      <div className="flex-1 flex overflow-hidden min-h-0 gap-6 p-6">
        {/* Left Sidebar - Steps */}
        <div className="w-80 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden shadow-sm flex-shrink-0">
          <div className="p-4 border-b border-gray-200 flex-shrink-0">
            <div className="text-sm font-medium mb-2">{prompt}</div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <span>🤖</span>
                <span>Open Browser</span>
              </div>
              <div className="flex items-center gap-1">
                <span>📝</span>
                <span>ToolCall</span>
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {logs.map((log, index) => {
              // Group thinking logs with their corresponding action
              if (log.type === 'thinking') {
                return null; // Skip thinking logs, they'll be shown with actions
              }

              // Find associated thinking log
              const thinkingLog = index > 0 && logs[index - 1].type === 'thinking' ? logs[index - 1] : null;

              if (log.stepNumber && log.stepTitle) {
                // Check if this is a bug/failure step
                const isBugStep = thinkingLog && (thinkingLog.content.toLowerCase().includes('test failed') || thinkingLog.content.toLowerCase().includes('bug detected'));
                const bgColor = isBugStep ? 'bg-red-50' : 'bg-purple-50';
                const borderColor = isBugStep ? 'border-red-200' : 'border-purple-200';
                
                return (
                  <div key={index} className={`${bgColor} rounded-lg border ${borderColor} overflow-hidden`}>
                    {/* Step Header */}
                    <div className="p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-white/50 text-purple-700 font-semibold text-sm flex items-center justify-center flex-shrink-0">
                          {log.stepNumber}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-base mb-1">{log.stepTitle}</h3>
                        </div>
                      </div>

                      {/* Thinking/Explanation */}
                      {thinkingLog && (
                        <p className="text-sm text-gray-700 mb-3 leading-relaxed">
                          {thinkingLog.content}
                        </p>
                      )}

                      {/* ToolCall Section */}
                      {log.functionName && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-gray-500">› ToolCall</span>
                          <code className="px-2 py-0.5 bg-white/60 rounded text-gray-800 font-mono">
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
                  <div key={index} className="flex items-center gap-2 text-xs text-gray-500 px-2">
                    <span>{getLogIcon(log.type)}</span>
                    <span>{log.content}</span>
                  </div>
                );
              }

              // For error and complete logs
              return (
                <div
                  key={index}
                  className={`text-sm p-3 rounded-lg border ${getLogBackground(log.content)}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base">{getLogIcon(log.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="break-words text-sm">{log.content}</p>
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
