const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const showError = message => Swal.fire({ icon: 'error', title: 'Atención', text: message, confirmButtonColor: '#5c723f' });
const showSuccess = (title, text) => Swal.fire({ icon: 'success', title, text, confirmButtonColor: '#5c723f' });

function getRoleDisplay(role) {
    const normalizedRole = String(role ?? '').toLowerCase();
    if (normalizedRole === 'admin') return { label: 'Administrador', className: 'role-admin' };
    if (normalizedRole === 'vendedor') return { label: 'Vendedor / Empleado', className: 'role-vendedor' };
    return { label: role || 'Sin rol', className: 'role-other' };
}

let usuarios = [];

async function cargarUsuarios() {
    try {
        const data = await executeNeonQuery('SELECT id, usuario, rol FROM usuario ORDER BY id');
        usuarios = data || [];
        renderUsuarios();
    } catch (error) {
        showError('No se pudieron cargar los usuarios: ' + error.message);
    }
}

function renderUsuarios() {
    const tbody = document.getElementById('tabla-usuarios');
    if (!tbody) return;
    if (!usuarios.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay usuarios registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = usuarios.map(u => {
        const roleDisplay = getRoleDisplay(u.rol);
        return `
            <tr>
                <td>${escapeHtml(u.id)}</td>
                <td><strong>${escapeHtml(u.usuario)}</strong></td>
                <td><span class="role-badge ${roleDisplay.className}">${escapeHtml(roleDisplay.label)}</span></td>
                <td style="text-align:center;">
                    <div class="user-actions">
                        <button type="button" class="user-action btn-editar" data-id="${escapeHtml(u.id)}" title="Editar Usuario">✏️</button>
                        <button type="button" class="user-action delete btn-eliminar" data-id="${escapeHtml(u.id)}" title="Eliminar Usuario">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function crearUsuario(event) {
    event.preventDefault();
    const usuarioInput = document.getElementById('usuario').value.trim();
    const passwordInput = document.getElementById('password').value;
    const rolInput = document.getElementById('rol').value;

    if (!usuarioInput || !passwordInput) {
        return showError('Completá todos los campos obligatorios.');
    }
    if (passwordInput.length < 4) {
        return showError('La contraseña debe tener al menos 4 caracteres.');
    }

    try {
        await executeNeonQuery(
            'INSERT INTO usuario (usuario, password, rol) VALUES ($1, $2, $3)',
            [usuarioInput, passwordInput, rolInput]
        );

        document.getElementById('form-usuario').reset();
        await cargarUsuarios();
        showSuccess('¡Usuario Creado! 👤', 'El nuevo usuario fue registrado con éxito.');
    } catch (error) {
        showError('No se pudo crear el usuario: ' + error.message);
    }
}

async function editarUsuario(id) {
    const user = usuarios.find(u => String(u.id) === String(id));
    if (!user) return;

    const { value: formValues } = await Swal.fire({
        title: 'Editar Usuario',
        html: `
            <div class="swal-user-form" style="text-align:left;">
                <div class="swal-user-field">
                    <label for="swal-usuario">Nombre de Usuario</label>
                    <input id="swal-usuario" class="swal2-input" value="${escapeHtml(user.usuario)}" style="margin:0;width:100%;">
                </div>
                <div class="swal-user-field" style="margin-top:10px;">
                    <label for="swal-password">Nueva Contraseña (dejar en blanco para no cambiar)</label>
                    <input id="swal-password" type="password" class="swal2-input" placeholder="••••" style="margin:0;width:100%;">
                </div>
                <div class="swal-user-field" style="margin-top:10px;">
                    <label for="swal-rol">Rol</label>
                    <select id="swal-rol" class="swal2-select" style="margin:0;width:100%;height:44px;background:#fbf9f4;border:1px solid #d4dfc7;border-radius:10px;padding:0 10px;">
                        <option value="vendedor" ${String(user.rol).toLowerCase() === 'vendedor' ? 'selected' : ''}>Vendedor / Empleado</option>
                        <option value="admin" ${String(user.rol).toLowerCase() === 'admin' ? 'selected' : ''}>Administrador</option>
                    </select>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#5c723f',
        cancelButtonColor: '#a95c42',
        confirmButtonText: 'Guardar Cambios',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            return {
                usuario: document.getElementById('swal-usuario').value.trim(),
                password: document.getElementById('swal-password').value,
                rol: document.getElementById('swal-rol').value
            };
        }
    });

    if (!formValues) return;
    if (!formValues.usuario) return showError('El nombre de usuario no puede estar vacío.');
    if (formValues.password && formValues.password.length < 4) {
        return showError('La nueva contraseña debe tener al menos 4 caracteres.');
    }

    try {
        if (formValues.password) {
            await executeNeonQuery(
                'UPDATE usuario SET usuario = $1, password = $2, rol = $3 WHERE id = $4',
                [formValues.usuario, formValues.password, formValues.rol, id]
            );
        } else {
            await executeNeonQuery(
                'UPDATE usuario SET usuario = $1, rol = $2 WHERE id = $3',
                [formValues.usuario, formValues.rol, id]
            );
        }

        await cargarUsuarios();
        showSuccess('¡Actualizado! ✨', 'Los datos del usuario fueron modificados correctamente.');
    } catch (error) {
        showError('No se pudo actualizar: ' + error.message);
    }
}

async function eliminarUsuario(id) {
    const user = usuarios.find(u => String(u.id) === String(id));
    const confirmation = await Swal.fire({
        title: '¿Eliminar usuario?',
        text: `Se borrará el acceso para "${user?.usuario || ''}".`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#5c723f',
        cancelButtonColor: '#a95c42',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
    });

    if (!confirmation.isConfirmed) return;

    try {
        await executeNeonQuery('DELETE FROM usuario WHERE id = $1', [id]);
        await cargarUsuarios();
        showSuccess('¡Eliminado! 🗑️', 'El usuario fue eliminado del sistema.');
    } catch (error) {
        showError('No se pudo eliminar el usuario: ' + error.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem('usuario')) {
        window.location.replace('login.html');
        return;
    }
    if (String(localStorage.getItem('rol') || '').toLowerCase() !== 'admin') {
        window.location.replace('panel.html');
        return;
    }

    cargarUsuarios();

    const formUsuario = document.getElementById('form-usuario');
    if (formUsuario) formUsuario.addEventListener('submit', crearUsuario);

    const tablaUsuarios = document.getElementById('tabla-usuarios');
    if (tablaUsuarios) {
        tablaUsuarios.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            const id = button.dataset.id;
            if (button.classList.contains('btn-editar')) editarUsuario(id);
            if (button.classList.contains('btn-eliminar')) eliminarUsuario(id);
        });
    }
});