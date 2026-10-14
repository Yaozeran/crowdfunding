"""Application factory for the public blockchain transaction index."""
from flask import Flask
from web3 import Web3
from .config import configure_app
from .database import init_database
from .routes import api
from .platform import platform


def create_app(config=None, provider=None):
    app = Flask(__name__)
    configure_app(app, config)
    app.extensions["web3"] = provider or Web3(
        Web3.HTTPProvider(app.config["RPC_URL"], request_kwargs={"timeout": 10})
    )
    with app.app_context():
        init_database()
    app.register_blueprint(api)
    app.register_blueprint(platform)
    return app
