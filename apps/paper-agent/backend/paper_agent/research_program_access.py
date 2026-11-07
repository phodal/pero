"""Host-authenticated entry to a saved Paper research plan."""
from .model import Invalid, digest, text
from .research_program_store import ResearchPrograms
from dataclasses import replace
from datetime import datetime


def program_request(programs: ResearchPrograms, value, now, *, internal=False):
    operation = value.get('operation')
    if not internal:
        if operation in ('create', 'list', 'read', 'export'):
            return programs.command(value, now)
        if operation == 'stop':
            program = programs.read(value.get('programId'))
            programs.jobs.cancel(program.id)
            return programs.command(dict(operation='finish', programId=program.id, operationId=value['operationId'],
                expectedCheckpoint=program.checkpoint, reason='user_stopped'), now)
        if operation != 'launch':
            raise Invalid('Research mutations require the bound Host session', 403)
    with programs.store.lock:
        program = programs.read(value.get('programId'))
        protocol_digest = digest(program.protocol.to_dict())
        descriptor = dict(context=dict(kind='paper-autoresearch', programId=program.id, protocolDigest=protocol_digest),
                          protocol=program.protocol.to_dict(), checkpoint=program.checkpoint,
                          prompt='Use the mounted paper-autoresearch Skill for this bound program.\n\nApproved plan:\n' + __import__('json').dumps(program.protocol.to_dict(), ensure_ascii=False))
        if operation == 'launch':
            return descriptor
        path = programs.directory(program.id) / 'binding.json'
        if operation == 'bind':
            program.admit(program.checkpoint, now)
            if value.get('protocolDigest') != protocol_digest:
                raise Invalid('The approved research plan changed', 409)
            thread = text(value.get('threadId'), 128, 'Host session')
            binding = dict(threadId=thread, protocolDigest=protocol_digest)
            if path.exists() and programs._read(path) != binding:
                raise Invalid('This research plan already belongs to its original Host session', 409)
            programs._write(path, binding)
            return descriptor
        if not path.exists() or programs._read(path)['threadId'] != value.get('threadId'):
            raise Invalid('This caller does not own the research program', 403)
        command = {k: v for k, v in value.items() if k != 'threadId'}
        if operation == 'observe-run':
            status = value.get('status')
            if status not in ('running', 'cancelling', 'needs_input', 'completed', 'failed', 'cancelled', 'interrupted'):
                raise Invalid('Invalid Host run state')
            programs._write(programs.directory(program.id) / 'runtime.json', {k: value.get(k) for k in ('status', 'modelRequestsUsed', 'appCallsUsed')})
            if status in ('cancelling', 'completed', 'failed', 'cancelled', 'interrupted'):
                programs.jobs.cancel(program.id)
            if status in ('completed', 'failed', 'cancelled', 'interrupted') and (program.executionStatus != status or program.modelRequestsUsed != value['modelRequestsUsed'] or program.appCallsUsed != value['appCallsUsed']):
                program = program.observe_terminal(status, value['modelRequestsUsed'], value['appCallsUsed'], value['threadId'], now)
                programs.save(program)
            return programs.view(program)
        if operation == 'resume':
            resumed = replace(program, stopReason=None) if program.stopReason in ('runtime_incomplete', 'needs_input') else program
            resumed.admit(resumed.checkpoint, now)
            programs.save(program.advance(stopReason=resumed.stopReason, executionStatus='running'))
            return programs.view(programs.read(program.id))
        if operation == 'feedback':
            expired = datetime.fromisoformat(now.replace('Z', '+00:00')) >= datetime.fromisoformat(program.protocol.deadline.replace('Z', '+00:00'))
            return dict(programId=program.id, checkpoint=program.checkpoint, stopReason=program.stopReason,
                        rounds=program.usage.rounds, gapCount=len(program.gaps),
                        pendingJob=any(programs._read(programs.directory(program.id) / 'jobs' / identity / 'job.json')['status'] == 'running'
                                       for identity in program.jobIds),
                        continueResearch=not program.stopReason and not expired, nextAction='Read the current program and continue from its saved evidence gaps. Poll unfinished jobs first.')
        if operation in ('create', 'bind', 'list'):
            raise Invalid('Operation is not available to the research Agent', 403)
        try:
            return programs.jobs.command(command, now) if operation in ('search', 'discover', 'acquire', 'poll') else programs.command(command, now)
        except Invalid as error:
            if error.status != 413:
                raise
            # Keep the existing source owner's capacity contract. Program exports live separately.
            program = programs.read(program.id)
            if not program.stopReason:
                program = program.finish('storage_capacity')
                programs.save(program)
            programs.jobs.cancel(program.id)
            return {**programs.view(program), 'blocker': str(error)}
