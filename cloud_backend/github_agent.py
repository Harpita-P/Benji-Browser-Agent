import json
import os
import uuid
from typing import Dict, List

from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams
from google.genai import types

APP_NAME = "benji_github_mcp_app"
GITHUB_ADK_MCP_MODEL_NAME = os.getenv("GITHUB_ADK_MCP_MODEL_NAME", "gemini-2.5-pro") or "gemini-2.5-pro"
GITHUB_MCP_URL = os.getenv("GITHUB_MCP_URL", "https://api.githubcopilot.com/mcp/")
DEFAULT_TOOLSETS = "context,repos,issues,labels,pull_requests,actions,users,orgs"
AGENT_INSTRUCTION = """
You are a GitHub engineering agent focused on UI/workflow bug reports.

Default operating mode:
1) Investigate the target repository and locate root-cause code paths.
2) Propose a concise fix plan covering all impacted layers (UI, API, validation, schema, tests).
3) Implement the fix with minimal, consistent changes.
4) Update/add tests when test patterns exist in the repo.
5) Execute Git workflow: create branch, commit, open pull request.

Behavior rules:
- Prefer root-cause fixes over superficial patches.
- Verify assumptions by reading relevant files before changing code.
- Keep naming/style consistent with the repository.
- If repo or file identity is missing, ask for owner/repo and exact scope once.
- If blocked by permissions/tool limitations, report blockers clearly and stop.
- If write actions are allowed, do not stop at analysis; complete the branch/commit/PR workflow.

Pull request quality requirements (mandatory):
- PR title must be concise and fix-focused (example: "Fix: add medium priority option for tasks").
- PR body must be detailed and use this exact structure:
  ## Summary
  <1-3 sentences describing user-visible bug and fix impact>

  ## Root Cause
  - <where bug was found>
  - <why it happened>

  ## Changes Made
  - `<file-path>`: <what changed and why>
  - `<file-path>`: <what changed and why>

  ## Validation
  - <tests/checks run and results>
  - <if not run, clearly state what could not be validated>

  ## Git Actions
  - Branch: <branch-name>
  - Commit: <commit-sha>
  - PR: <pull-request-url>

- After opening the PR, add a PR comment that repeats the same structured summary (Findings/Changes/Git Actions/Validation) for easy review context.
- Keep the write-up concrete and repository-specific; do not use generic placeholders in final PR text.

When you finish, ALWAYS return this structured summary:
- Findings: where the bug was found and why it happened
- Changes: files/logic updated (and tests updated, if any)
- Git Actions:
  - Branch: <branch-name>
  - Commit: <commit-sha>
  - PR: <pull-request-url>
- Validation: tests/checks run, or what could not be run
""".strip()


def _build_toolset(github_token: str) -> McpToolset:
    return McpToolset(
        connection_params=StreamableHTTPServerParams(
            url=GITHUB_MCP_URL,
            headers={
                "Authorization": f"Bearer {github_token}",
                "X-MCP-Toolsets": os.getenv("GITHUB_MCP_TOOLSETS", DEFAULT_TOOLSETS),
                "X-MCP-Readonly": os.getenv("GITHUB_MCP_READONLY", "false"),
            },
        )
    )


class GitHubCodeFixingAgent:
    def __init__(self, github_token: str | None = None):
        if not github_token:
            github_token = os.getenv("GITHUB_TOKEN")
        if not github_token:
            raise ValueError("GITHUB_TOKEN environment variable required")

        toolset = _build_toolset(github_token)
        root_agent = LlmAgent(
            model=GITHUB_ADK_MCP_MODEL_NAME,
            name="github_agent",
            instruction=AGENT_INSTRUCTION,
            tools=[toolset],
        )

        self.session_service = InMemorySessionService()
        self.runner = Runner(
            app_name=APP_NAME,
            agent=root_agent,
            artifact_service=InMemoryArtifactService(),
            session_service=self.session_service,
        )

    async def analyze_and_fix(
        self,
        session_logs: List[Dict],
        repo_owner: str,
        repo_name: str,
        app_url: str | None = None,
    ) -> Dict:
        full_logs_json = json.dumps(session_logs, indent=2, ensure_ascii=True)
        prompt = f"""
Bug report from Benji Computer Use run (full raw session context below).

Target repository: {repo_owner}/{repo_name}
Application URL: {app_url or "Not provided"}

IMPORTANT:
- Use the full session logs below as source-of-truth context.
- Investigate the target repository with MCP tools.
- Identify root cause.
- Implement a fix via branch + commit + pull request.
- Ensure PR title/body and PR comment follow the formatting requirements in your instruction exactly.
- Return the structured summary format from your system instruction.

FULL SESSION LOGS (RAW JSON):
{full_logs_json}
""".strip()

        session = await self.session_service.create_session(
            state={},
            app_name=APP_NAME,
            user_id=f"benji-{uuid.uuid4()}",
        )

        content = types.Content(role="user", parts=[types.Part(text=prompt)])
        events = self.runner.run_async(
            session_id=session.id,
            user_id=session.user_id,
            new_message=content,
        )

        final_text_parts: List[str] = []
        try:
            async for event in events:
                content_obj = getattr(event, "content", None)
                if not content_obj:
                    continue

                parts = getattr(content_obj, "parts", None) or []
                for part in parts:
                    text = getattr(part, "text", None)
                    if text:
                        final_text_parts.append(text)
        finally:
            aclose = getattr(events, "aclose", None)
            if callable(aclose):
                await aclose()

        final_text = "\n".join(final_text_parts).strip()
        return {
            "status": "success" if final_text else "failed",
            "analysis": final_text or "No response",
            "agent_response": final_text or "No response",
        }


async def create_github_agent(github_token: str | None = None) -> GitHubCodeFixingAgent:
    return GitHubCodeFixingAgent(github_token)
