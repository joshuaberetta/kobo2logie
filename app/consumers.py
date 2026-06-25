import json
import logging

from channels.generic.websocket import AsyncWebsocketConsumer

from .models import SubmissionLog

logger = logging.getLogger(__name__)


class SubmissionConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.uid = self.scope['url_route']['kwargs']['uid']
        self.group_name = f'form_{self.uid}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Send the last 50 log entries on connect so the page loads with history
        from channels.db import database_sync_to_async

        @database_sync_to_async
        def get_recent():
            return list(
                SubmissionLog.objects
                .filter(form_uid=self.uid)
                .order_by('-ts')[:50]
            )

        entries = await get_recent()
        for entry in reversed(entries):
            payload = {'ts': entry.ts, 'uuid': entry.uuid, 'id': entry.submission_id, **entry.data}
            await self.send(text_data=json.dumps({'type': 'log', 'data': payload}))

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        pass  # clients are read-only

    async def submission_push(self, event):
        """Called by group_send from the pipeline thread."""
        await self.send(text_data=json.dumps({'type': 'submission', 'data': json.loads(event['data'])}))
