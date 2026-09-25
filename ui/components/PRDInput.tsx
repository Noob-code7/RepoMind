import React, { useState } from 'react';

interface PRDInputProps {
  onSubmit: (prd: string, projectName: string) => void;
  disabled?: boolean;
}

const SAMPLE_PRDS: Record<string, { title: string; content: string }> = {
  taskApi: {
    title: 'Task Management REST API',
    content: `# Task Management API PRD
## Overview
A lightweight Node.js/TypeScript REST API for managing user tasks with JWT authentication.

## Requirements
1. **User Authentication**:
   - Register user with email and hashed password.
   - Login user and emit signed JWT tokens.
2. **Task CRUD**:
   - Create task with title, description, priority (low, medium, high), and dueDate.
   - List tasks with filtering by priority and status (pending, completed).
   - Update task status and mark completed.
   - Delete task.
3. **Data Storage**:
   - Clean in-memory repository with thread-safe data operations.
4. **Validation & Testing**:
   - Input validation for email format and non-empty titles.
   - Unit tests covering auth workflows and task operations.`,
  },
  noteSync: {
    title: 'Markdown Note Sync Engine',
    content: `# Markdown Note Sync Engine PRD
## Overview
A local-first document indexing and markdown note synchronization engine.

## Requirements
1. **Document Storage**:
   - File manifest tracking document hashes, timestamps, and title tags.
2. **Search Indexing**:
   - In-memory inverted index of document content for fast keyword search.
3. **Conflict Resolution**:
   - Last-write-wins and 3-way merge detection with clear error flags.
4. **Testing**:
   - Unit tests for index queries and conflict detection.`,
  },
};

export const PRDInput: React.FC<PRDInputProps> = ({ onSubmit, disabled }) => {
  const [projectName, setProjectName] = useState('task_master_api');
  const [prdText, setPrdText] = useState(SAMPLE_PRDS.taskApi.content);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prdText.trim()) return;
    onSubmit(prdText.trim(), projectName.trim() || 'braid_app');
  };

  return (
    <div className="card p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></span>
            1. PRD Ingestion & Project Setup
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Provide product requirements or select a verified hackathon PRD template.
          </p>
        </div>
        <div className="flex gap-2">
          {Object.entries(SAMPLE_PRDS).map(([key, item]) => (
            <button
              key={key}
              type="button"
              id={`preset-${key}`}
              disabled={disabled}
              onClick={() => setPrdText(item.content)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            >
              Load {item.title}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="projectNameInput"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
          >
            Project Slug Name
          </label>
          <input
            id="projectNameInput"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            disabled={disabled}
            placeholder="e.g. task_master_api"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div>
          <label
            htmlFor="prdTextInput"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1"
          >
            Product Requirements Document (Markdown / Text)
          </label>
          <textarea
            id="prdTextInput"
            rows={10}
            value={prdText}
            onChange={(e) => setPrdText(e.target.value)}
            disabled={disabled}
            placeholder="# Write your PRD here..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <button
          type="submit"
          id="startPipelineBtn"
          disabled={disabled || !prdText.trim()}
          className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200 flex items-center justify-center gap-2"
        >
          <span>Initiate Autonomous SDLC Pipeline</span>
          <span>&rarr;</span>
        </button>
      </form>
    </div>
  );
};
