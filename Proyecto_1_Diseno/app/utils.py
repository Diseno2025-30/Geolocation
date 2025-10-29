# app/utils.py
import subprocess
from app.config import IS_TEST_MODE, BRANCH_NAME, NAME

def get_git_info():
    """Obtiene información de la rama, commit y fecha de git."""
    try:
        if IS_TEST_MODE and BRANCH_NAME != 'main':
            branch = BRANCH_NAME
            environment = 'TEST'
        else:
            try:
                branch = subprocess.check_output(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).decode('utf-8').strip()
            except:
                branch = 'main'
            environment = 'PRODUCTION'
        
        try:
            commit = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD']).decode('utf-8').strip()
        except:
            commit = 'unknown'
        
        try:
            date = subprocess.check_output(['git', 'log', '-1', '--format=%cd', '--date=short']).decode('utf-8').strip()
        except:
            date = 'unknown'
        
        return {
            'branch': branch,
            'commit': commit,
            'date': date,
            'is_test': IS_TEST_MODE,
            'environment': environment,
            'server_name': NAME
        }
    except:
        return {
            'branch': BRANCH_NAME if IS_TEST_MODE else 'main',
            'commit': 'unknown',
            'date': 'unknown',
            'is_test': IS_TEST_MODE,
            'environment': 'TEST' if IS_TEST_MODE else 'PRODUCTION',
            'server_name': NAME
        }