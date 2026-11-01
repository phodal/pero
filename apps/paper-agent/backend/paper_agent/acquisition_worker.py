"""One killable envelope for approved PDF and source acquisition/parsing."""
import multiprocessing
import os
import threading
import time

from .model import Invalid


def acquisition_child(output, target, args, seconds):
    parent, done = multiprocessing.parent_process(), threading.Event()

    def watchdog():
        deadline = time.monotonic() + seconds
        while not done.wait(0.1):
            if time.monotonic() >= deadline or (parent and not parent.is_alive()):
                os._exit(2)

    threading.Thread(target=watchdog, daemon=True).start()
    try:
        target(output, *args)
    except Invalid as error:
        output.send(('error', error.detail, error.status))
    except Exception as error:
        output.send(('error', f'Acquisition failed ({type(error).__name__}). Retry this file.', 500))
    finally:
        done.set()
        output.close()


def acquire_bounded(target, args, cancelled, seconds, stage):
    context = multiprocessing.get_context('spawn')
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=acquisition_child, args=(send, target, args, seconds), daemon=True)
    try:
        process.start()
        send.close()
        deadline = time.monotonic() + seconds
        while True:
            if cancelled.is_set():
                return ('cancelled', 'Acquisition cancelled.')
            if time.monotonic() >= deadline:
                return ('failed', 'Acquisition or parsing timed out. Retry this file.')
            if receive.poll(0.05):
                try:
                    message = receive.recv()
                except EOFError:
                    return ('failed', 'Acquisition worker interrupted or timed out. Retry this file.')
                if message[0] == 'stage':
                    stage(message[1])
                elif message[0] == 'error':
                    return ('denied' if message[2] in (401, 403, 429) else 'failed', message[1])
                else:
                    return message
            elif not process.is_alive():
                return ('failed', 'Acquisition worker interrupted or timed out. Retry this file.')
    finally:
        if process.pid:
            if process.is_alive():
                process.terminate()
            process.join(timeout=1)
            if process.is_alive():
                process.kill()
                process.join(timeout=1)
            process.close()
        receive.close()
        send.close()
