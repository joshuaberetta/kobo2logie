from django.urls import path

from . import views

urlpatterns = [
    # Webhook receiver
    path('hook/<str:uid>/', views.hook, name='hook'),

    # Submission logs
    path('logs/<str:uid>/', views.logs, name='logs'),

    # Media proxy
    path('media/', views.media_proxy, name='media_proxy'),

    # Retry
    path('retry/<str:uid>/', views.retry, name='retry'),

    # Configure
    path('configure/rest-service/', views.configure_rest_service, name='configure_rest_service'),
    path('configure/permissions/', views.configure_permissions, name='configure_permissions'),
    path('configure/project/<str:uid>/', views.configure_project, name='configure_project'),
    path('configure/survey/<str:uid>/', views.configure_survey, name='configure_survey'),
    path('configure/condition/generate/', views.configure_condition_generate, name='configure_condition_generate'),

    # Auth (preserved from poc_template)
    path('auth/login/', views.login_view, name='login'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('auth/me/', views.me_view, name='me'),
]
