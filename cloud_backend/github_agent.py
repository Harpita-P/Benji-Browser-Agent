"""
GitHub Code Fixing Agent - Analyzes CUA session logs and fixes bugs using GitHub MCP ADK
"""

import os
import sys
from typing import Dict, List
from google.adk.agents import Agent
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams


class GitHubCodeFixingAgent:
    """Agent that analyzes CUA session logs and fixes bugs in GitHub repos."""
    
    def __init__(self, github_token: str = None):
        """Initialize the GitHub code fixing agent."""
        if not github_token:
            github_token = os.getenv("GITHUB_TOKEN")
            if not github_token:
                raise ValueError("GITHUB_TOKEN environment variable required")
        
        self.github_token = github_token
        
        # Create ADK agent with GitHub MCP integration
        self.agent = Agent(
            model="gemini-2.0-flash-exp",
            name="benji_github_fixer",
            instruction="""You are Benji, an AI Software Engineer that analyzes UI testing session logs and fixes bugs.

Your workflow:
1. Receive session logs from Computer Use Agent (CUA) testing
2. Analyze the logs to understand:
   - What the user was trying to do
   - What actions were taken (clicks, typing, navigation)
   - What the agent was thinking at each step
   - Where things went wrong or behaved unexpectedly
3. Reason about potential bugs in the codebase based on the UI behavior
4. Use GitHub MCP tools to:
   - Search the repository for relevant files
   - Read code files that likely contain the bug
   - Analyze the code to find the exact issue
5. Suggest precise code fixes with:
   - File path and line numbers
   - Current buggy code
   - Fixed code
   - Explanation of the root cause
   - Why this fix solves the problem

You are thorough, analytical, and provide actionable fixes. You explain your reasoning clearly.""",
            tools=[
                McpToolset(
                    connection_params=StreamableHTTPServerParams(
                        url="https://api.githubcopilot.com/mcp/",
                        headers={
                            "Authorization": f"Bearer {github_token}",
                            "X-MCP-Toolsets": "repos,issues,pull_requests",
                            "X-MCP-Readonly": "false"
                        },
                    ),
                )
            ],
        )
    
    async def analyze_and_fix(
        self,
        session_logs: List[Dict],
        repo_owner: str,
        repo_name: str,
        app_url: str = None
    ) -> Dict:
        """
        Analyze session logs and suggest code fixes.
        
        Args:
            session_logs: List of log entries from CUA session
            repo_owner: GitHub repository owner
            repo_name: GitHub repository name
            app_url: URL of the application being tested
        
        Returns:
            {
                "status": "success" | "failed",
                "analysis": "Detailed analysis of the bug",
                "suggested_fixes": [
                    {
                        "file": "path/to/file.tsx",
                        "line_start": 42,
                        "line_end": 45,
                        "current_code": "...",
                        "fixed_code": "...",
                        "explanation": "..."
                    }
                ],
                "root_cause": "Explanation of why the bug occurred",
                "agent_response": "Full agent response"
            }
        """
        
        # Format session logs for analysis
        log_summary = self._format_session_logs(session_logs)
        
        # Construct prompt for the agent
        prompt = f"""
# Bug Analysis Request

## Application Context
- **Repository:** {repo_owner}/{repo_name}
- **App URL:** {app_url or 'Not provided'}

## Session Logs from Computer Use Agent Testing

{log_summary}

## Your Task

1. **Analyze the session logs** to understand what happened during the UI test
2. **Identify potential bugs** based on:
   - Unexpected behavior
   - Actions that didn't produce expected results
   - UI elements that behaved incorrectly
   - Any errors or issues mentioned in the thinking logs

3. **Search the GitHub repository** for files that likely contain the bug:
   - Look for component files related to the UI elements
   - Search for relevant keywords from the session logs
   - Identify the most likely files

4. **Read and analyze the code** to find the exact bug location

5. **Suggest precise fixes** with:
   - Exact file paths and line numbers
   - Current buggy code
   - Fixed code
   - Clear explanation of the root cause
   - Why your fix solves the problem

Start by analyzing the session logs and reasoning about what bugs might exist.
"""
        
        try:
            # Run the agent
            response = await self.agent.run(prompt)
            
            # Parse response (in production, you'd parse more carefully)
            return {
                "status": "success",
                "analysis": str(response),
                "agent_response": response
            }
        except Exception as e:
            return {
                "status": "failed",
                "error": str(e)
            }
    
    def _format_session_logs(self, logs: List[Dict]) -> str:
        """Format session logs into a readable summary."""
        formatted = []
        
        for i, log in enumerate(logs, 1):
            log_type = log.get("type", "unknown")
            
            if log_type == "prompt":
                formatted.append(f"\n### Initial User Request\n{log.get('content', '')}\n")
            
            elif log_type == "thinking":
                turn = log.get("turn", "?")
                formatted.append(f"\n**Turn {turn} - Agent Thinking:**\n{log.get('content', '')}\n")
            
            elif log_type == "action":
                turn = log.get("turn", "?")
                function = log.get("function", "unknown")
                args = log.get("args", {})
                formatted.append(f"\n**Turn {turn} - Action:** `{function}`")
                if args:
                    formatted.append(f"  - Args: {args}")
                formatted.append("")
        
        return "\n".join(formatted)


async def create_github_agent(github_token: str = None) -> GitHubCodeFixingAgent:
    """Factory function to create a GitHub code fixing agent."""
    return GitHubCodeFixingAgent(github_token)
