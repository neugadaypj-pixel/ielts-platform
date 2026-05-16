require('dotenv').config();
const bcrypt = require('bcryptjs');
const { execute } = require('./database/connection');

(async () => {
    try {
        const newAdmin = 'Admin123';
        const newTeacher = 'Teacher123';
        const newStudent = 'Student123';
        
        const adminHash = await bcrypt.hash(newAdmin, 10);
        const teacherHash = await bcrypt.hash(newTeacher, 10);
        const studentHash = await bcrypt.hash(newStudent, 10);
        
        await execute('UPDATE users SET password = :pwd WHERE username = :uname', { pwd: adminHash, uname: 'jamolbek' });
        console.log('jamolbek (admin) -> Admin123');
        
        await execute('UPDATE users SET password = :pwd WHERE username = :uname', { pwd: teacherHash, uname: 'Mr_Farrukh' });
        console.log('Mr_Farrukh (teacher) -> Teacher123');
        
        // Reset first student too
        await execute("UPDATE users SET password = :pwd WHERE id = (SELECT MIN(id) FROM users WHERE role = 'student')", { pwd: studentHash });
        console.log('First student -> Student123');
    } catch(e) { console.error(e.message); }
})();
