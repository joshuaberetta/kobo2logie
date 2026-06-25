"""
ASGI config for kobo2logie — HTTP via Django + WebSocket via Django Channels.
"""

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application
from django.urls import path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

django_asgi_app = get_asgi_application()

from app.consumers import SubmissionConsumer  # noqa: E402 — must come after get_asgi_application

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            URLRouter([
                path('ws/stream/<str:uid>/', SubmissionConsumer.as_asgi()),
            ])
        )
    ),
})
